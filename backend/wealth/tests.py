from decimal import Decimal
from datetime import date
import ssl
from unittest.mock import MagicMock, patch
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import sleep

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, OperationalError, connection, transaction
from django.test import SimpleTestCase, TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from users.models import AppModule, UserModuleAccess
from .models import (
    CashFlowCategory, CashFlowEntry, CashFlowProfile, MutualFundScheme,
    WealthFundHouse, WealthFolio, WealthInstrument, WealthMFTransactionDetail,
    WealthMilestone, WealthSIPInstallment, WealthSIPMandate, WealthTransaction,
    WealthTransactionAudit,
)
from .holdings import calculate_moving_average_cost
from .serializers import WealthMFTransactionDetailSerializer, WealthSIPConfirmSerializer
from .sip import calculate_sip_purchase_values, monthly_installment_date


User = get_user_model()


class MovingAverageCostPureTests(SimpleTestCase):
    def transaction(self, kind, units='0', nav='0', amount='0', charges='0', cashflow='0', day='2026-01-01'):
        return {
            'transaction_type': kind,
            'transaction_date': date.fromisoformat(day),
            'mf_detail': {
                'units': units, 'nav': nav, 'amount': amount,
                'charges': charges, 'cashflow': cashflow,
            },
        }

    def test_charges_are_invested_cost_and_redemption_releases_average_cost(self):
        rows = [
            self.transaction('PURCHASE', '10', '10', '100', '5', '-105'),
            self.transaction('PURCHASE', '10', '12', '120', '0', '-120', '2026-01-02'),
            self.transaction('REDEMPTION', '8', '13', '104', '2', '102', '2026-01-03'),
        ]
        state = calculate_moving_average_cost(rows)
        self.assertEqual(state['units'], Decimal('12'))
        self.assertEqual(state['invested_cost'], Decimal('135.00'))
        self.assertEqual(state['average_cost_nav'], Decimal('11.2500'))
        self.assertEqual(state['realized_pl'], Decimal('12.00'))

    def test_confirmed_sip_derives_units_from_scheduled_amount_and_confirmed_nav(self):
        values = calculate_sip_purchase_values(
            Decimal('1000.00'), Decimal('30.0100'), date(2026, 11, 16), Decimal('0.12'),
            WealthMFTransactionDetail.ChargesSource.MANUAL,
        )
        self.assertEqual(values['units'], Decimal('33.3182'))
        self.assertEqual(values['amount'], Decimal('999.88'))
        self.assertEqual(values['total_amount'], Decimal('1000.00'))
        self.assertEqual(values['charges'], Decimal('0.12'))
        self.assertEqual(values['cashflow'], Decimal('-1000.00'))
        automatic = calculate_sip_purchase_values(
            Decimal('1000.00'), Decimal('30.0100'), date(2026, 11, 16),
        )
        self.assertEqual(automatic['units'], Decimal('33.3206'))
        self.assertEqual(automatic['amount'], Decimal('999.95'))
        self.assertEqual(automatic['charges'], Decimal('0.05'))
        self.assertEqual(automatic['cashflow'], Decimal('-1000.00'))
        self.assertEqual(automatic['charges_source'], WealthMFTransactionDetail.ChargesSource.AUTOMATIC)
        example = calculate_sip_purchase_values(
            Decimal('30000.00'), Decimal('2169.5000'), date(2026, 11, 16), Decimal('1.50'),
        )
        self.assertEqual(example['amount'], Decimal('29998.50'))
        self.assertEqual(example['units'], Decimal('13.8274'))
        self.assertEqual(example['cashflow'], Decimal('-30000.00'))

    def test_sip_confirmation_serializer_does_not_require_units_or_amount_and_validates_nav_charges(self):
        valid = {'actual_date': '2026-11-16', 'actual_nav': '30.0100'}
        serializer = WealthSIPConfirmSerializer(data=valid)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        for field, invalid in (
            ('actual_nav', '0.0000'), ('actual_charges', '-0.01'),
        ):
            payload = {**valid, field: invalid}
            serializer = WealthSIPConfirmSerializer(data=payload)
            self.assertFalse(serializer.is_valid(), f'{field}={invalid} unexpectedly passed')
            self.assertIn(field, serializer.errors)

    def test_monthly_sip_days_clamp_to_month_end_including_leap_years(self):
        cases = [
            ((2025, 2, 29), date(2025, 2, 28)),
            ((2024, 2, 29), date(2024, 2, 29)),
            ((2026, 4, 30), date(2026, 4, 30)),
            ((2026, 1, 31), date(2026, 1, 31)),
            ((2026, 4, 31), date(2026, 4, 30)),
        ]
        for args, expected in cases:
            with self.subTest(args=args):
                self.assertEqual(monthly_installment_date(*args), expected)

    def test_bonus_units_add_no_cost_and_dividends_are_separate_income(self):
        rows = [
            self.transaction('PURCHASE', '10', '10', '100', '5', '-105'),
            self.transaction('BONUS', '2', day='2026-01-02'),
            self.transaction('DIVIDEND', amount='3', cashflow='3', day='2026-01-03'),
        ]
        state = calculate_moving_average_cost(rows)
        self.assertEqual(state['units'], Decimal('12'))
        self.assertEqual(state['invested_cost'], Decimal('105.00'))
        self.assertEqual(state['average_cost_nav'], Decimal('8.7500'))
        self.assertEqual(state['dividend_income'], Decimal('3.00'))

    def test_negative_position_marks_basis_unreliable(self):
        state = calculate_moving_average_cost([
            self.transaction('REDEMPTION', '2', '10', '20', '0', '20'),
        ])
        self.assertLess(state['units'], 0)
        self.assertFalse(state['reliable'])
        self.assertIsNone(state['invested_cost'])


class CashFlowCalculationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='planner@example.com', password='Cash-flow-123', full_name='Planner'
        )
        self.profile = CashFlowProfile.objects.create(user=self.user)

    def make_entry(self, section, name, amount, category_name=None):
        category, _ = CashFlowCategory.objects.get_or_create(
            user=self.user,
            section=section,
            name=category_name or section.title(),
        )
        return CashFlowEntry.objects.create(
            profile=self.profile,
            category=category,
            name=name,
            amount=Decimal(amount),
        )

    def test_empty_profile_and_zero_income_return_zero_totals_and_savings_rate(self):
        self.assertEqual(self.profile.calculate_totals(), {
            'income': Decimal('0.00'),
            'savings': Decimal('0.00'),
            'expenses': Decimal('0.00'),
            'surplus': Decimal('0.00'),
            'savings_rate': Decimal('0.00'),
        })

        self.make_entry(CashFlowCategory.Section.SAVINGS, 'Investments', '250.00')
        totals = self.profile.calculate_totals()
        self.assertEqual(totals['savings_rate'], Decimal('0.00'))
        self.assertEqual(totals['surplus'], Decimal('-250.00'))

    def test_decimal_totals_keep_savings_separate_and_compute_positive_surplus(self):
        self.make_entry(CashFlowCategory.Section.INCOME, 'Salary', '100000.10')
        self.make_entry(CashFlowCategory.Section.SAVINGS, 'Monthly SIPs', '10000.05')
        self.make_entry(CashFlowCategory.Section.EXPENSES, 'Household', '8000.01')

        totals = self.profile.calculate_totals()

        self.assertEqual(totals['income'], Decimal('100000.10'))
        self.assertEqual(totals['savings'], Decimal('10000.05'))
        self.assertEqual(totals['expenses'], Decimal('8000.01'))
        self.assertEqual(totals['surplus'], Decimal('82000.04'))
        self.assertEqual(totals['savings_rate'], Decimal('10.00'))

    def test_negative_surplus_is_preserved_as_a_shortfall(self):
        self.make_entry(CashFlowCategory.Section.INCOME, 'Salary', '50000.00')
        self.make_entry(CashFlowCategory.Section.SAVINGS, 'Investments', '12000.00')
        self.make_entry(CashFlowCategory.Section.EXPENSES, 'Living costs', '45000.00')

        self.assertEqual(self.profile.calculate_totals()['surplus'], Decimal('-7000.00'))


class CashFlowApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.wealth, _ = AppModule.objects.get_or_create(
            code='wealth', defaults={'name': 'WealthOnCruise'}
        )
        cls.tradedesk, _ = AppModule.objects.get_or_create(
            code='tradedesk', defaults={'name': 'TradeDesk'}
        )

    def setUp(self):
        self.user = User.objects.create_user(
            email='cashflow@example.com', password='Cash-flow-123', full_name='Cash Flow User'
        )
        self.other_user = User.objects.create_user(
            email='other@example.com', password='Cash-flow-123', full_name='Other User'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.grant(self.user, self.wealth)

    def grant(self, user, module):
        return UserModuleAccess.objects.create(user=user, module=module)

    def category(self, user, section, name):
        return CashFlowCategory.objects.create(user=user, section=section, name=name)

    def add_entry(self, category, name, amount):
        profile, _ = CashFlowProfile.objects.get_or_create(user=category.user)
        return self.client.post(reverse('wealth-cash-flow-entries'), {
            'name': name,
            'category': category.pk,
            'amount': amount,
        }, format='json')

    def test_profile_is_created_and_persisted_for_authenticated_wealth_user(self):
        url = reverse('wealth-cash-flow-profile')
        first = self.client.get(url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['totals']['surplus'], '0.00')
        self.assertEqual(CashFlowProfile.objects.filter(user=self.user).count(), 1)

        salary = self.category(self.user, CashFlowCategory.Section.INCOME, 'Salary')
        created = self.add_entry(salary, 'Monthly salary', '125000.00')
        self.assertEqual(created.status_code, 201)

        fresh_client = APIClient()
        fresh_client.force_authenticate(self.user)
        persisted = fresh_client.get(url)
        self.assertEqual(persisted.data['totals']['income'], '125000.00')
        self.assertEqual(persisted.data['totals']['surplus'], '125000.00')
        self.assertEqual(len(persisted.data['entries']), 1)

    def test_entry_add_edit_delete_recalculates_totals(self):
        salary = self.category(self.user, CashFlowCategory.Section.INCOME, 'Salary')
        savings = self.category(self.user, CashFlowCategory.Section.SAVINGS, 'Investments')
        expenses = self.category(self.user, CashFlowCategory.Section.EXPENSES, 'Household')

        income = self.add_entry(salary, 'Salary', '100000.00')
        saving = self.add_entry(savings, 'SIP commitments', '15000.00')
        expense = self.add_entry(expenses, 'Monthly bills', '30000.00')
        self.assertEqual((income.status_code, saving.status_code, expense.status_code), (201, 201, 201))
        profile_url = reverse('wealth-cash-flow-profile')
        self.assertEqual(self.client.get(profile_url).data['totals']['surplus'], '55000.00')

        entry_url = reverse('wealth-cash-flow-entry-detail', args=[expense.data['id']])
        edited = self.client.patch(entry_url, {'amount': '35000.25'}, format='json')
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(self.client.get(profile_url).data['totals']['surplus'], '49999.75')

        deleted = self.client.delete(entry_url)
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get(profile_url).data['totals']['surplus'], '85000.00')

    def test_category_create_rename_archive_and_restore(self):
        collection_url = reverse('wealth-cash-flow-categories')
        created = self.client.post(collection_url, {'section': 'INCOME', 'name': 'Consulting'}, format='json')
        self.assertEqual(created.status_code, 201)
        detail_url = reverse('wealth-cash-flow-category-detail', args=[created.data['id']])

        renamed = self.client.patch(detail_url, {'name': 'Business income'}, format='json')
        self.assertEqual(renamed.data['name'], 'Business income')
        archived = self.client.delete(detail_url)
        self.assertTrue(archived.data['is_archived'])
        restored = self.client.patch(detail_url, {'is_archived': False}, format='json')
        self.assertFalse(restored.data['is_archived'])

    def test_readding_archived_normalized_category_reactivates_and_preserves_entries(self):
        category = self.category(self.user, CashFlowCategory.Section.EXPENSES, 'Utilities')
        entry_response = self.add_entry(category, 'Electricity', '1800.00')
        entry = CashFlowEntry.objects.get(pk=entry_response.data['id'])
        self.client.delete(reverse('wealth-cash-flow-category-detail', args=[category.pk]))

        response = self.client.post(reverse('wealth-cash-flow-categories'), {
            'section': 'EXPENSES', 'name': '  uTiLiTiEs  ',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['id'], category.pk)
        self.assertEqual(response.data['name'], 'Utilities')
        self.assertFalse(response.data['is_archived'])
        entry.refresh_from_db()
        self.assertEqual(entry.category_id, category.pk)
        self.assertEqual(self.client.get(reverse('wealth-cash-flow-profile')).data['totals']['expenses'], '1800.00')

    def test_active_normalized_duplicate_returns_clear_name_error(self):
        self.category(self.user, CashFlowCategory.Section.INCOME, 'Salary')

        response = self.client.post(reverse('wealth-cash-flow-categories'), {
            'section': 'INCOME', 'name': '  sALary  ',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['name'], ['This category already exists.'])
        self.assertEqual(CashFlowCategory.objects.filter(user=self.user, section='INCOME').count(), 1)

    def test_database_rejects_normalized_active_duplicates(self):
        self.category(self.user, CashFlowCategory.Section.INCOME, 'Salary')

        with self.assertRaises(IntegrityError), transaction.atomic():
            CashFlowCategory.objects.create(
                user=self.user,
                section=CashFlowCategory.Section.INCOME,
                name=' salary ',
            )

    def test_restore_conflict_returns_name_error_and_keeps_category_archived(self):
        active = self.category(self.user, CashFlowCategory.Section.EXPENSES, 'Groceries')
        self.client.delete(reverse('wealth-cash-flow-category-detail', args=[active.pk]))
        archived = CashFlowCategory.objects.create(
            user=self.user,
            section=CashFlowCategory.Section.EXPENSES,
            name=' groceries ',
            is_archived=True,
        )
        self.client.patch(
            reverse('wealth-cash-flow-category-detail', args=[active.pk]),
            {'is_archived': False},
            format='json',
        )

        response = self.client.patch(
            reverse('wealth-cash-flow-category-detail', args=[archived.pk]),
            {'is_archived': False},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['name'], ['This category already exists.'])
        restored_candidate = CashFlowCategory.objects.get(pk=archived.pk)
        self.assertTrue(restored_candidate.is_archived)
        self.assertFalse(active.is_archived)

    def test_category_names_are_unique_by_user_and_section(self):
        self.category(self.user, CashFlowCategory.Section.INCOME, 'Consulting')
        savings = self.client.post(reverse('wealth-cash-flow-categories'), {
            'section': 'SAVINGS', 'name': ' consulting ',
        }, format='json')
        expenses = self.client.post(reverse('wealth-cash-flow-categories'), {
            'section': 'EXPENSES', 'name': 'CONSULTING',
        }, format='json')
        foreign = self.category(self.other_user, CashFlowCategory.Section.INCOME, ' consulting ')

        self.assertEqual(savings.status_code, 201)
        self.assertEqual(expenses.status_code, 201)
        self.assertNotEqual(foreign.user_id, self.user.pk)

    def test_archived_category_from_another_user_is_not_reactivated(self):
        foreign = self.category(self.other_user, CashFlowCategory.Section.INCOME, 'Consulting')
        foreign.is_archived = True
        foreign.save(update_fields=['is_archived'])

        response = self.client.post(reverse('wealth-cash-flow-categories'), {
            'section': 'INCOME', 'name': ' consulting ',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertNotEqual(response.data['id'], foreign.pk)
        foreign.refresh_from_db()
        self.assertTrue(foreign.is_archived)

    def test_archiving_category_preserves_existing_entries_and_totals(self):
        category = self.category(self.user, CashFlowCategory.Section.EXPENSES, 'Utilities')
        created = self.add_entry(category, 'Electricity', '1800.00')
        detail_url = reverse('wealth-cash-flow-category-detail', args=[category.pk])

        archived = self.client.delete(detail_url)

        self.assertEqual(archived.status_code, 200)
        self.assertTrue(archived.data['is_archived'])
        profile = self.client.get(reverse('wealth-cash-flow-profile'))
        self.assertEqual(profile.data['totals']['expenses'], '1800.00')
        self.assertEqual(profile.data['entries'][0]['id'], created.data['id'])

    def test_category_and_entry_lists_are_scoped_to_authenticated_user(self):
        own_category = self.category(self.user, CashFlowCategory.Section.INCOME, 'Salary')
        other_category = self.category(self.other_user, CashFlowCategory.Section.INCOME, 'Salary')
        self.add_entry(own_category, 'Own salary', '80000.00')
        other_profile = CashFlowProfile.objects.create(user=self.other_user)
        other_entry = CashFlowEntry.objects.create(
            profile=other_profile, category=other_category, name='Private salary', amount='90000.00'
        )

        profile = self.client.get(reverse('wealth-cash-flow-profile'))
        categories = self.client.get(reverse('wealth-cash-flow-categories'))
        entries = self.client.get(reverse('wealth-cash-flow-entries'))

        self.assertEqual(len(profile.data['entries']), 1)
        self.assertEqual(profile.data['entries'][0]['name'], 'Own salary')
        self.assertEqual([row['id'] for row in categories.data], [own_category.pk])
        self.assertEqual([row['id'] for row in entries.data], [profile.data['entries'][0]['id']])

        other_detail = reverse('wealth-cash-flow-entry-detail', args=[other_entry.pk])
        self.assertEqual(self.client.patch(other_detail, {'amount': '1.00'}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(other_detail).status_code, 404)

    def test_expense_breakdown_is_grouped_by_saved_category(self):
        home = self.category(self.user, CashFlowCategory.Section.EXPENSES, 'Household')
        travel = self.category(self.user, CashFlowCategory.Section.EXPENSES, 'Travel')
        self.add_entry(home, 'Groceries', '12000.00')
        self.add_entry(home, 'Utilities', '4000.00')
        self.add_entry(travel, 'Commute', '2500.00')

        response = self.client.get(reverse('wealth-cash-flow-profile'))

        self.assertEqual(response.data['totals']['expenses'], '18500.00')
        self.assertEqual(response.data['expense_breakdown'], [
            {'category_id': home.pk, 'category_name': 'Household', 'amount': '16000.00'},
            {'category_id': travel.pk, 'category_name': 'Travel', 'amount': '2500.00'},
        ])

    def test_entry_cannot_be_created_with_another_users_category(self):
        foreign_category = self.category(self.other_user, CashFlowCategory.Section.INCOME, 'Salary')
        response = self.client.post(reverse('wealth-cash-flow-entries'), {
            'name': 'Foreign category entry',
            'category': foreign_category.pk,
            'amount': '100.00',
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CashFlowEntry.objects.exists())

    def test_amount_must_be_positive_and_category_duplicates_are_rejected(self):
        category = self.category(self.user, CashFlowCategory.Section.INCOME, 'Salary')
        invalid_entry = self.add_entry(category, 'No amount', '0.00')
        duplicate = self.client.post(reverse('wealth-cash-flow-categories'), {
            'section': 'INCOME', 'name': 'salary',
        }, format='json')
        self.assertEqual(invalid_entry.status_code, 400)
        self.assertEqual(duplicate.status_code, 400)

    def test_wealth_endpoints_require_authentication_and_wealth_module_grant(self):
        category_url = reverse('wealth-cash-flow-category-detail', args=[999999])
        entry_url = reverse('wealth-cash-flow-entry-detail', args=[999999])
        requests = [
            lambda client: client.get(reverse('wealth-cash-flow-profile')),
            lambda client: client.get(reverse('wealth-cash-flow-categories')),
            lambda client: client.post(reverse('wealth-cash-flow-categories'), {'section': 'INCOME', 'name': 'Salary'}, format='json'),
            lambda client: client.patch(category_url, {'name': 'Updated'}, format='json'),
            lambda client: client.delete(category_url),
            lambda client: client.get(reverse('wealth-cash-flow-entries')),
            lambda client: client.post(reverse('wealth-cash-flow-entries'), {'name': 'Salary', 'category': 1, 'amount': '1.00'}, format='json'),
            lambda client: client.patch(entry_url, {'amount': '2.00'}, format='json'),
            lambda client: client.delete(entry_url),
        ]
        self.assertTrue(all(request(APIClient()).status_code == 401 for request in requests))

        no_access_user = User.objects.create_user(
            email='no-access@example.com', password='Cash-flow-123', full_name='No Access'
        )
        no_access = APIClient()
        no_access.force_authenticate(no_access_user)
        self.assertTrue(all(request(no_access).status_code == 403 for request in requests))

        trade_only_user = User.objects.create_user(
            email='trade-only@example.com', password='Cash-flow-123', full_name='Trade Only'
        )
        self.grant(trade_only_user, self.tradedesk)
        trade_only = APIClient()
        trade_only.force_authenticate(trade_only_user)
        self.assertTrue(all(request(trade_only).status_code == 403 for request in requests))

    def test_category_and_entry_mutations_are_only_available_to_the_owner(self):
        category = self.category(self.other_user, CashFlowCategory.Section.SAVINGS, 'Investments')
        detail_url = reverse('wealth-cash-flow-category-detail', args=[category.pk])
        self.assertEqual(self.client.patch(detail_url, {'name': 'Changed'}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(detail_url).status_code, 404)
        self.assertEqual(category.name, CashFlowCategory.objects.get(pk=category.pk).name)


class WealthMFTransactionDetailAccountingPureTests(SimpleTestCase):
    def make_detail(self, kind, *, source='MANUAL', units='5.0000', nav='20.0000',
                    amount='100.00', charges='0.00', cashflow='-100.00'):
        detail = WealthMFTransactionDetail(
            units=Decimal(units), nav=Decimal(nav), amount=Decimal(amount),
            charges=Decimal(charges), cashflow=Decimal(cashflow),
        )
        detail.transaction = WealthTransaction(transaction_type=kind, source=source)
        return detail

    def assert_detail_invalid(self, detail, field):
        with self.assertRaises(DjangoValidationError) as raised:
            detail.clean()
        self.assertIn(field, raised.exception.message_dict)

    def test_regular_purchase_and_redemption_require_amount_to_match_units_times_nav(self):
        for kind, cashflow in (
            (WealthTransaction.TransactionType.PURCHASE, '-100.00'),
            (WealthTransaction.TransactionType.REDEMPTION, '100.00'),
        ):
            with self.subTest(kind=kind):
                self.make_detail(kind, cashflow=cashflow).clean()
                self.assert_detail_invalid(
                    self.make_detail(kind, amount='99.99', cashflow=cashflow), 'amount',
                )

        rounded = self.make_detail(
            WealthTransaction.TransactionType.PURCHASE,
            units='1.0000', nav='1.0050', amount='1.01', cashflow='-1.01',
        )
        rounded.clean()

    def test_switch_in_and_out_require_amount_to_match_units_times_nav(self):
        for kind, cashflow in (
            (WealthTransaction.TransactionType.SWITCH_IN, '-100.00'),
            (WealthTransaction.TransactionType.SWITCH_OUT, '100.00'),
        ):
            with self.subTest(kind=kind):
                self.make_detail(kind, cashflow=cashflow).clean()
                self.assert_detail_invalid(
                    self.make_detail(kind, amount='99.99', cashflow=cashflow), 'amount',
                )

    def test_cashflow_equations_include_charges_for_regular_unit_transactions(self):
        cases = (
            (WealthTransaction.TransactionType.PURCHASE, '-105.00'),
            (WealthTransaction.TransactionType.SWITCH_IN, '-105.00'),
            (WealthTransaction.TransactionType.REDEMPTION, '95.00'),
            (WealthTransaction.TransactionType.SWITCH_OUT, '95.00'),
        )
        for kind, expected_cashflow in cases:
            with self.subTest(kind=kind):
                self.make_detail(
                    kind, charges='5.00', cashflow=expected_cashflow,
                ).clean()
                wrong_cashflow = '-100.00' if expected_cashflow.startswith('-') else '100.00'
                self.assert_detail_invalid(
                    self.make_detail(
                        kind, charges='5.00', cashflow=wrong_cashflow,
                    ),
                    'cashflow',
                )

    def test_sip_purchase_validates_rounded_units_and_total_debit_cashflow(self):
        self.make_detail(
            WealthTransaction.TransactionType.PURCHASE, source='SIP',
            units='33.3182', nav='30.0100', amount='999.88', charges='0.12',
            cashflow='-1000.00',
        ).clean()
        self.assert_detail_invalid(
            self.make_detail(
                WealthTransaction.TransactionType.PURCHASE, source='SIP',
                units='33.3181', nav='30.0100', amount='999.88', charges='0.12',
                cashflow='-1000.00',
            ),
            'units',
        )
        self.assert_detail_invalid(
            self.make_detail(
                WealthTransaction.TransactionType.PURCHASE, source='SIP',
                units='33.3182', nav='30.0100', amount='999.88', charges='0.12',
                cashflow='-999.99',
            ),
            'cashflow',
        )
        self.make_detail(
            WealthTransaction.TransactionType.PURCHASE, source='SIP',
            units='0.1235', nav='8.1000', amount='1.00', charges='0.00',
            cashflow='-1.00',
        ).clean()

    def test_dividend_bonus_and_other_do_not_apply_units_nav_amount_rule(self):
        cases = (
            (WealthTransaction.TransactionType.DIVIDEND, '1.0000', '2.0000', '7.00', '1.00', '3.00'),
            (WealthTransaction.TransactionType.BONUS, '1.0000', '2.0000', '7.00', '0.00', '0.00'),
            (WealthTransaction.TransactionType.OTHER, '1.0000', '2.0000', '7.00', '1.00', '12.00'),
        )
        for kind, units, nav, amount, charges, cashflow in cases:
            with self.subTest(kind=kind):
                self.make_detail(
                    kind, units=units, nav=nav, amount=amount, charges=charges,
                    cashflow=cashflow,
                ).clean()

    def test_maximum_serializer_valid_units_and_nav_return_validation_not_decimal_overflow(self):
        detail_serializer = WealthMFTransactionDetailSerializer()
        units = detail_serializer.fields['units'].run_validation('999999999999999999.9999')
        nav = detail_serializer.fields['nav'].run_validation('99999999999999.9999')
        amount = detail_serializer.fields['amount'].run_validation('9999999999999999.99')
        cashflow = detail_serializer.fields['cashflow'].run_validation('-9999999999999999.99')
        detail = WealthMFTransactionDetail(
            units=units, nav=nav, amount=amount, charges=Decimal('0'), cashflow=cashflow,
        )
        detail.transaction = WealthTransaction(
            transaction_type=WealthTransaction.TransactionType.PURCHASE,
            source=WealthTransaction.Source.MANUAL,
        )
        self.assert_detail_invalid(detail, 'amount')


class WealthMilestoneCalculationTests(TestCase):
    def make_milestone(self, **overrides):
        values = {
            'user_id': 1,
            'name': 'Home purchase',
            'present_amount': Decimal('100000.00'),
            'target_year': 2031,
            'inflation_rate': Decimal('7.00'),
            'expected_return_rate': Decimal('12.00'),
        }
        values.update(overrides)
        return WealthMilestone(**values)

    def test_inflation_calculation_rounds_to_two_rupees_decimals(self):
        projection = self.make_milestone().calculate_projection(current_year=2026)

        self.assertEqual(projection['future_amount'], Decimal('140255.17'))
        self.assertEqual(projection['years_remaining'], 5)

    def test_years_remaining_uses_configured_local_date_automatically(self):
        milestone = self.make_milestone()
        with patch('wealth.models.timezone.localdate', return_value=date(2028, 1, 1)):
            projection = milestone.calculate_projection()

        self.assertEqual(projection['years_remaining'], 3)
        self.assertEqual(projection['future_amount'], Decimal('122504.30'))

    def test_sip_uses_beginning_of_month_formula_at_default_and_changed_return_rates(self):
        default_projection = self.make_milestone().calculate_projection(current_year=2026)
        changed_projection = self.make_milestone(
            expected_return_rate=Decimal('8.00'),
        ).calculate_projection(current_year=2026)

        self.assertEqual(default_projection['required_monthly_sip'], Decimal('1700.34'))
        self.assertEqual(changed_projection['required_monthly_sip'], Decimal('1896.19'))

    def test_zero_return_divides_future_amount_by_month_count(self):
        projection = self.make_milestone(
            expected_return_rate=Decimal('0.00'),
        ).calculate_projection(current_year=2026)

        self.assertEqual(projection['required_monthly_sip'], Decimal('2337.59'))

    def test_non_future_target_has_no_required_sip_projection(self):
        projection = self.make_milestone(target_year=2026).calculate_projection(current_year=2026)

        self.assertEqual(projection['years_remaining'], 0)
        self.assertIsNone(projection['required_monthly_sip'])


class WealthMilestoneApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.wealth, _ = AppModule.objects.get_or_create(
            code='wealth', defaults={'name': 'WealthOnCruise'}
        )
        cls.tradedesk, _ = AppModule.objects.get_or_create(
            code='tradedesk', defaults={'name': 'TradeDesk'}
        )

    def setUp(self):
        self.user = User.objects.create_user(
            email='milestones@example.com', password='Milestone-123', full_name='Milestone User'
        )
        self.other_user = User.objects.create_user(
            email='other-milestones@example.com', password='Milestone-123', full_name='Other Milestone User'
        )
        UserModuleAccess.objects.create(user=self.user, module=self.wealth)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.collection_url = reverse('wealth-milestones')

    def payload(self, **overrides):
        values = {
            'name': 'Home purchase',
            'present_amount': '100000.00',
            'target_year': timezone.localdate().year + 5,
            'inflation_rate': '7.00',
            'expected_return_rate': '12.00',
        }
        values.update(overrides)
        return values

    def test_milestone_create_list_update_and_delete(self):
        created = self.client.post(self.collection_url, self.payload(), format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['name'], 'Home purchase')
        self.assertEqual(created.data['inflation_rate'], '7.00')
        self.assertEqual(created.data['expected_return_rate'], '12.00')

        listed = self.client.get(self.collection_url)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data['current_year'], timezone.localdate().year)
        self.assertEqual(len(listed.data['milestones']), 1)

        detail_url = reverse('wealth-milestone-detail', args=[created.data['id']])
        updated = self.client.patch(detail_url, {'name': 'Education fund'}, format='json')
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data['name'], 'Education fund')

        deleted = self.client.delete(detail_url)
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get(self.collection_url).data['milestones'], [])

    def test_milestones_are_private_to_each_authenticated_user(self):
        created = self.client.post(self.collection_url, self.payload(), format='json')
        detail_url = reverse('wealth-milestone-detail', args=[created.data['id']])
        other_client = APIClient()
        other_client.force_authenticate(self.other_user)
        UserModuleAccess.objects.create(user=self.other_user, module=self.wealth)

        self.assertEqual(other_client.get(self.collection_url).data['milestones'], [])
        self.assertEqual(other_client.patch(detail_url, {'name': 'Changed'}, format='json').status_code, 404)
        self.assertEqual(other_client.delete(detail_url).status_code, 404)

    def test_target_year_must_be_in_the_future(self):
        current_date = date(2032, 5, 1)
        with patch('wealth.serializers.timezone.localdate', return_value=current_date):
            response = self.client.post(self.collection_url, self.payload(target_year=2032), format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('Target year must be in the future.', str(response.data['target_year']))

    def test_milestone_endpoints_require_authentication_and_wealth_access(self):
        detail_url = reverse('wealth-milestone-detail', args=[999999])
        requests = [
            lambda client: client.get(self.collection_url),
            lambda client: client.post(self.collection_url, self.payload(), format='json'),
            lambda client: client.patch(detail_url, {'name': 'Updated'}, format='json'),
            lambda client: client.delete(detail_url),
        ]
        self.assertTrue(all(request(APIClient()).status_code == 401 for request in requests))

        no_access_user = User.objects.create_user(
            email='milestone-no-access@example.com', password='Milestone-123', full_name='No Access'
        )
        no_access = APIClient()
        no_access.force_authenticate(no_access_user)
        self.assertTrue(all(request(no_access).status_code == 403 for request in requests))

        trade_only_user = User.objects.create_user(
            email='milestone-trade-only@example.com', password='Milestone-123', full_name='Trade Only'
        )
        UserModuleAccess.objects.create(user=trade_only_user, module=self.tradedesk)
        trade_only = APIClient()
        trade_only.force_authenticate(trade_only_user)
        self.assertTrue(all(request(trade_only).status_code == 403 for request in requests))


from unittest.mock import patch

from django.urls import reverse
from rest_framework.test import APIClient

from .models import MutualFundScheme, SchemeCatalogueImportLog
from .scheme_catalogue import (
    DOWNLOAD_TIMEOUT_SECONDS, CatalogueError, download_source, initialize_scheme_catalogue,
    parse_source, refresh_scheme_catalogue,
)


def catalogue_source(rows=10, *, category='Equity Scheme - Large Cap Fund', house='Sample Mutual Fund'):
    lines = [
        'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
        f'Open Ended Schemes({category})', house,
    ]
    for index in range(rows):
        plan = 'Direct Plan' if index % 2 == 0 else 'Regular Plan'
        option = 'Growth Option' if index % 3 == 0 else ('IDCW Payout' if index % 3 == 1 else 'IDCW Reinvestment')
        isin = f'INF000K{index:04d}A'
        reinvest = f'INF000K{index:04d}B' if 'IDCW' in option else '-'
        lines.append(f'{100000 + index};{isin};{reinvest};Sample Scheme {index};{plan};{option};123.45;28-Oct-2026')
    return '\n'.join(lines)


class SchemeCatalogueParserTests(TestCase):
    def test_parses_source_header_bom_section_house_plans_options_and_isins(self):
        result = parse_source('\ufeff' + catalogue_source())

        self.assertEqual(result.parsed_count, 10)
        self.assertEqual(result.rejected_count, 0)
        self.assertEqual(result.records[0]['plan_type'], MutualFundScheme.PlanType.DIRECT)
        self.assertEqual(result.records[1]['plan_type'], MutualFundScheme.PlanType.REGULAR)
        self.assertEqual(result.records[0]['option_type'], MutualFundScheme.OptionType.GROWTH)
        self.assertEqual(result.records[1]['option_type'], MutualFundScheme.OptionType.IDCW)
        self.assertEqual(result.records[0]['asset_class'], MutualFundScheme.AssetClass.EQUITY)
        self.assertEqual(result.records[0]['fund_house'], 'Sample Mutual Fund')
        self.assertEqual(result.records[0]['isin_growth'], 'INF000K0000A')
        self.assertIsNone(result.records[0]['isin_div_payout'])


class SchemeCatalogueDownloadTests(TestCase):
    def test_download_uses_certifi_ca_bundle_with_hostname_verification_and_timeout(self):
        import certifi

        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'AMFI catalogue data'
        with patch('wealth.scheme_catalogue.urllib.request.urlopen', return_value=response) as urlopen, \
             patch('wealth.scheme_catalogue.ssl.create_default_context', wraps=ssl.create_default_context) as make_context:
            result = download_source()

        self.assertEqual(result, 'AMFI catalogue data')
        request = urlopen.call_args.args[0]
        context = urlopen.call_args.kwargs['context']
        make_context.assert_called_once_with(cafile=certifi.where())
        self.assertEqual(request.full_url, 'https://portal.amfiindia.com/spages/NAVAll.txt')
        self.assertEqual(urlopen.call_args.kwargs['timeout'], DOWNLOAD_TIMEOUT_SECONDS)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        self.assertGreater(context.cert_store_stats()['x509_ca'], 0)

    def test_ssl_certificate_error_is_wrapped_safely_with_original_cause(self):
        ssl_error = ssl.SSLCertVerificationError(1, 'unable to get local issuer certificate')
        with patch('wealth.scheme_catalogue.urllib.request.urlopen', side_effect=ssl_error):
            with self.assertRaises(CatalogueError) as raised:
                download_source()

        self.assertIs(raised.exception.__cause__, ssl_error)
        self.assertEqual(str(raised.exception), 'Could not download the AMFI scheme catalogue.')
        self.assertNotIn('local issuer', str(raised.exception))

    def test_skips_blank_headings_and_rejects_malformed_candidate_rows(self):
        source = catalogue_source() + '\n\nnot a scheme heading\n100999;Broken'
        result = parse_source(source)
        self.assertEqual(result.parsed_count, 11)
        self.assertEqual(result.rejected_count, 1)
        self.assertEqual(len(result.records), 10)

    def test_missing_optional_isins_and_unknown_classification_are_preserved(self):
        source = catalogue_source(category='Other Scheme')
        source = source.replace('INF000K0000A;-;Sample Scheme 0', '-;-;Sample Scheme 0')
        row = parse_source(source).records[0]
        self.assertEqual(row['asset_class'], MutualFundScheme.AssetClass.OTHER)
        self.assertIsNone(row['isin_growth'])
        self.assertIsNone(row['isin_div_reinvestment'])

    def test_supports_legacy_six_column_rows_without_inventing_classification(self):
        source = '\n'.join(f'{i};Legacy Scheme {i};-;-;10.0;28-Oct-2026' for i in range(1000, 1010))
        result = parse_source(source)
        self.assertEqual(len(result.records), 10)
        self.assertEqual(result.records[0]['asset_class'], MutualFundScheme.AssetClass.UNKNOWN)
        self.assertEqual(result.records[0]['plan_type'], MutualFundScheme.PlanType.UNKNOWN)

    def test_duplicate_scheme_codes_are_rejected_instead_of_duplicated(self):
        row = '100000;INF000K0000A;-;Sample Scheme 0;Direct Plan;Growth Option;123.45;28-Oct-2026'
        result = parse_source(catalogue_source() + '\n' + row)
        self.assertEqual(result.parsed_count, 11)
        self.assertEqual(result.rejected_count, 1)
        self.assertEqual(len(result.records), 10)


class SchemeCatalogueLoaderTests(TestCase):
    def test_empty_initialization_downloads_and_imports_once_then_skips(self):
        with patch('wealth.scheme_catalogue.download_source', return_value=catalogue_source()) as download:
            result = initialize_scheme_catalogue()
            repeated = initialize_scheme_catalogue()
        self.assertEqual(result['inserted'], 10)
        self.assertEqual(repeated['status'], 'SKIPPED')
        self.assertEqual(download.call_count, 1)
        self.assertEqual(SchemeCatalogueImportLog.objects.order_by('id').last().status, 'SKIPPED')

    def test_populated_initialization_skips_without_modifying_schemes_or_downloading(self):
        existing = MutualFundScheme.objects.create(scheme_code='9', scheme_name='Keep me', last_seen_at=timezone.now())
        with patch('wealth.scheme_catalogue.download_source') as download:
            result = initialize_scheme_catalogue()
        existing.refresh_from_db()
        self.assertEqual(result['status'], 'SKIPPED')
        self.assertEqual(existing.scheme_name, 'Keep me')
        download.assert_not_called()

    def test_initialization_failure_is_logged_and_a_later_attempt_can_retry(self):
        with patch('wealth.scheme_catalogue.download_source', side_effect=[
            CatalogueError('Could not download the AMFI scheme catalogue.'),
            catalogue_source(),
        ]) as download:
            with self.assertRaises(CatalogueError):
                initialize_scheme_catalogue()
            result = initialize_scheme_catalogue()

        self.assertEqual(result['inserted'], 10)
        self.assertEqual(MutualFundScheme.objects.count(), 10)
        self.assertEqual(SchemeCatalogueImportLog.objects.filter(status='FAILED').count(), 1)
        self.assertEqual(SchemeCatalogueImportLog.objects.filter(status='SUCCESS').count(), 1)
        self.assertEqual(download.call_count, 2)

    def test_refresh_populates_an_empty_catalogue_and_records_success_counts(self):
        with patch('wealth.scheme_catalogue.download_source', return_value=catalogue_source()):
            result = refresh_scheme_catalogue()
        log = SchemeCatalogueImportLog.objects.get(pk=result['log_id'])
        self.assertEqual(MutualFundScheme.objects.count(), 10)
        self.assertEqual((log.operation, log.status), ('REFRESH', 'SUCCESS'))
        self.assertEqual((log.parsed_count, log.valid_count, log.inserted_count), (10, 10, 10))

    def test_refresh_always_downloads_and_updates_inserts_and_preserves_missing_rows(self):
        old = MutualFundScheme.objects.create(scheme_code='100000', scheme_name='Old name', last_seen_at=timezone.now())
        missing = MutualFundScheme.objects.create(scheme_code='old-only', scheme_name='Keep missing', last_seen_at=timezone.now())
        with patch('wealth.scheme_catalogue.download_source', return_value=catalogue_source()) as download:
            result = refresh_scheme_catalogue()
        old.refresh_from_db()
        self.assertEqual(result['updated'], 1)
        self.assertEqual(result['inserted'], 9)
        self.assertEqual(old.pk, 1)
        self.assertEqual(old.scheme_name, 'Sample Scheme 0')
        self.assertTrue(MutualFundScheme.objects.filter(pk=missing.pk).exists())
        download.assert_called_once()

    def test_unchanged_metadata_is_not_written(self):
        source = catalogue_source()
        with patch('wealth.scheme_catalogue.download_source', return_value=source):
            initialize_scheme_catalogue()
        scheme = MutualFundScheme.objects.get(scheme_code='100000')
        old_updated = scheme.updated_at
        old_seen = scheme.last_seen_at
        with patch('wealth.scheme_catalogue.download_source', return_value=source):
            result = refresh_scheme_catalogue()
        scheme.refresh_from_db()
        self.assertEqual(result['unchanged'], 10)
        self.assertEqual(scheme.updated_at, old_updated)
        self.assertEqual(scheme.last_seen_at, old_seen)

    def test_download_and_validation_failures_do_not_change_catalogue(self):
        existing = MutualFundScheme.objects.create(scheme_code='existing', scheme_name='Original', last_seen_at=timezone.now())
        with patch('wealth.scheme_catalogue.download_source', side_effect=CatalogueError('Download failed')):
            with self.assertRaises(CatalogueError):
                refresh_scheme_catalogue()
        with patch('wealth.scheme_catalogue.download_source', return_value='broken'):
            with self.assertRaises(CatalogueError):
                refresh_scheme_catalogue()
        existing.refresh_from_db()
        self.assertEqual(MutualFundScheme.objects.count(), 1)
        self.assertEqual(existing.scheme_name, 'Original')
        self.assertEqual(SchemeCatalogueImportLog.objects.filter(status='FAILED').count(), 2)

    def test_repeated_refresh_does_not_duplicate_records(self):
        source = catalogue_source()
        with patch('wealth.scheme_catalogue.download_source', return_value=source):
            refresh_scheme_catalogue()
            refresh_scheme_catalogue()
        self.assertEqual(MutualFundScheme.objects.count(), 10)

    def test_database_write_failure_rolls_back_partial_refresh(self):
        existing = MutualFundScheme.objects.create(scheme_code='existing', scheme_name='Original', last_seen_at=timezone.now())
        original_bulk_create = MutualFundScheme.objects.bulk_create

        def insert_then_fail(rows, **kwargs):
            original_bulk_create(list(rows)[:1], **kwargs)
            raise RuntimeError('simulated persistence failure')

        with patch('wealth.scheme_catalogue.download_source', return_value=catalogue_source()), \
             patch.object(MutualFundScheme.objects, 'bulk_create', side_effect=insert_then_fail):
            with self.assertRaises(CatalogueError):
                refresh_scheme_catalogue()
        existing.refresh_from_db()
        self.assertEqual(MutualFundScheme.objects.count(), 1)
        self.assertEqual(existing.scheme_name, 'Original')


class SchemeCatalogueConcurrencyTests(TransactionTestCase):
    def test_concurrent_refresh_calls_are_serialized_without_duplicate_schemes(self):
        from django.db import close_old_connections

        active = 0
        maximum_active = 0
        state_lock = Lock()

        def delayed_source():
            nonlocal active, maximum_active
            with state_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            sleep(0.05)
            with state_lock:
                active -= 1
            return catalogue_source()

        def run_refresh():
            close_old_connections()
            try:
                return refresh_scheme_catalogue()
            finally:
                close_old_connections()

        with patch('wealth.scheme_catalogue.download_source', side_effect=delayed_source):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: run_refresh(), range(2)))
        self.assertEqual(maximum_active, 1)
        self.assertEqual(MutualFundScheme.objects.count(), 10)
        self.assertEqual(sorted(result['inserted'] for result in results), [0, 10])


class SchemeCatalogueApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.wealth, _ = AppModule.objects.get_or_create(code='wealth', defaults={'name': 'WealthOnCruise'})

    def setUp(self):
        self.user = User.objects.create_user(email='catalogue@example.com', password='Catalogue-123', full_name='Catalogue User')
        UserModuleAccess.objects.create(user=self.user, module=self.wealth)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.list_url = reverse('wealth-scheme-catalogue')

    def add_scheme(self, code, name, **fields):
        return MutualFundScheme.objects.create(scheme_code=code, scheme_name=name, last_seen_at=timezone.now(), **fields)

    def test_anonymous_and_non_wealth_users_are_denied(self):
        self.assertEqual(APIClient().get(self.list_url).status_code, 401)
        self.assertEqual(APIClient().get(reverse('wealth-scheme-catalogue-detail', args=['missing'])).status_code, 401)
        no_access = User.objects.create_user(email='no-wealth@example.com', password='Catalogue-123', full_name='No Wealth')
        client = APIClient()
        client.force_authenticate(no_access)
        self.assertEqual(client.get(self.list_url).status_code, 403)

    def test_wealth_user_can_search_filter_paginate_and_view_details(self):
        for index in range(30):
            self.add_scheme(str(index), f'Index Fund {index}', fund_house='Sample AMC', category_name='Equity Scheme', asset_class='EQUITY', plan_type='DIRECT', option_type='GROWTH')
        response = self.client.get(self.list_url, {'search': 'Index Fund', 'fund_house': 'Sample AMC', 'asset_class': 'EQUITY', 'category': 'Equity Scheme', 'plan_type': 'DIRECT', 'option_type': 'GROWTH', 'page_size': 10})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 30)
        self.assertEqual(len(response.data['results']), 10)
        detail = self.client.get(reverse('wealth-scheme-catalogue-detail', args=['1']))
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data['scheme_name'], 'Index Fund 1')
        self.assertEqual(self.client.get(self.list_url, {'asset_class': 'INVALID'}).status_code, 400)

    def test_search_matches_scheme_plan_option_code_and_distinguishes_variants(self):
        direct_growth = self.add_scheme(
            '12345', 'ICICI Prudential Example Fund', fund_house='ICICI Prudential',
            plan_type='DIRECT', option_type='GROWTH',
        )
        regular_growth = self.add_scheme(
            '12346', 'ICICI Prudential Example Fund', fund_house='ICICI Prudential',
            plan_type='REGULAR', option_type='GROWTH',
        )
        direct_idcw = self.add_scheme(
            '12347', 'ICICI Prudential Example Fund', fund_house='ICICI Prudential',
            plan_type='DIRECT', option_type='IDCW',
        )

        by_plan = self.client.get(self.list_url, {'search': 'Direct'})
        self.assertEqual(by_plan.status_code, 200)
        self.assertEqual({row['scheme_code'] for row in by_plan.data['results']}, {'12345', '12347'})

        by_option = self.client.get(self.list_url, {'search': 'IDCW'})
        self.assertEqual([row['scheme_code'] for row in by_option.data['results']], ['12347'])

        by_combined_variant = self.client.get(self.list_url, {'search': 'Direct Growth'})
        self.assertEqual([row['scheme_code'] for row in by_combined_variant.data['results']], ['12345'])

        by_code = self.client.get(self.list_url, {'search': '12346'})
        self.assertEqual([row['scheme_code'] for row in by_code.data['results']], ['12346'])
        self.assertEqual(regular_growth.scheme_code, '12346')
        self.assertEqual(direct_growth.scheme_name, direct_idcw.scheme_name)

    def test_first_catalogue_request_initializes_empty_catalogue_for_list_and_filters(self):
        with patch('wealth.scheme_catalogue.download_source', return_value=catalogue_source()) as download:
            response = self.client.get(self.list_url)
            filters = self.client.get(reverse('wealth-scheme-catalogue-filters'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 10)
        self.assertEqual(filters.status_code, 200)
        self.assertIn('Sample Mutual Fund', filters.data['fund_houses'])
        self.assertEqual(MutualFundScheme.objects.count(), 10)
        download.assert_called_once()

    def test_populated_catalogue_api_does_not_download_or_modify_schemes(self):
        scheme = self.add_scheme('321', 'Existing scheme')
        original_updated_at = scheme.updated_at
        original_last_seen_at = scheme.last_seen_at
        original_log_count = SchemeCatalogueImportLog.objects.count()

        with patch('wealth.scheme_catalogue.download_source') as download:
            response = self.client.get(self.list_url)
            filter_response = self.client.get(reverse('wealth-scheme-catalogue-filters'))

        scheme.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(filter_response.status_code, 200)
        self.assertEqual(scheme.updated_at, original_updated_at)
        self.assertEqual(scheme.last_seen_at, original_last_seen_at)
        self.assertEqual(SchemeCatalogueImportLog.objects.count(), original_log_count)
        download.assert_not_called()

    def test_failed_first_load_returns_service_unavailable_and_next_request_retries(self):
        with patch('wealth.scheme_catalogue.download_source', side_effect=[
            CatalogueError('Could not download the AMFI scheme catalogue.'),
            catalogue_source(),
        ]) as download:
            failed = self.client.get(self.list_url)
            retried = self.client.get(self.list_url)

        self.assertEqual(failed.status_code, 503)
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.data['count'], 10)
        self.assertEqual(SchemeCatalogueImportLog.objects.filter(status='FAILED').count(), 1)
        self.assertEqual(SchemeCatalogueImportLog.objects.filter(status='SUCCESS').count(), 1)
        self.assertEqual(download.call_count, 2)

    def test_unexpected_initialization_exception_is_logged_and_api_response_is_sanitized(self):
        with patch('wealth.scheme_catalogue.download_source', return_value=catalogue_source()), \
             patch.object(MutualFundScheme.objects, 'bulk_create', side_effect=RuntimeError('simulated persistence failure')):
            with self.assertLogs('wealth.scheme_catalogue', level='ERROR') as captured:
                response = self.client.get(self.list_url)

        log_output = '\n'.join(captured.output)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.data['detail'],
            'The scheme catalogue could not be initialized. Please retry.',
        )
        self.assertNotIn('Traceback', response.data['detail'])
        self.assertNotIn('simulated persistence failure', response.data['detail'])
        self.assertIn('stage=persistence', log_output)
        self.assertRegex(log_output, r'run_id=[0-9a-f]{32}')
        self.assertIn('Traceback (most recent call last)', log_output)
        self.assertIn('RuntimeError: simulated persistence failure', log_output)
        failure = SchemeCatalogueImportLog.objects.get(status='FAILED')
        self.assertIn('persistence:', failure.error_summary)
        self.assertRegex(failure.error_summary, r'run_id=[0-9a-f]{32}')
        self.assertNotIn('simulated persistence failure', failure.error_summary)

    def test_catalogue_existence_database_error_returns_sanitized_503_and_logs_traceback(self):
        database_error = OperationalError('simulated internal database failure')
        with patch.object(MutualFundScheme.objects, 'exists', side_effect=database_error), \
             patch('wealth.views.initialize_scheme_catalogue') as initialize:
            with self.assertLogs('wealth.scheme_catalogue', level='ERROR') as captured:
                response = self.client.get(self.list_url)

        log_output = '\n'.join(captured.output)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.data['detail'],
            'The scheme catalogue could not be initialized. Please retry.',
        )
        self.assertNotIn('simulated internal database failure', response.data['detail'])
        self.assertNotIn('Traceback', response.data['detail'])
        self.assertIn('operation=INITIAL', log_output)
        self.assertIn('stage=persistence', log_output)
        self.assertRegex(log_output, r'run_id=[0-9a-f]{32}')
        self.assertIn('Traceback (most recent call last)', log_output)
        self.assertIn('OperationalError: simulated internal database failure', log_output)
        initialize.assert_not_called()

    def test_pagination_defaults_caps_and_preserves_effective_page_metadata(self):
        now = timezone.now()
        MutualFundScheme.objects.bulk_create([
            MutualFundScheme(
                scheme_code=str(900000 + index),
                scheme_name=f'Pagination scheme {index:03d}',
                last_seen_at=now,
            )
            for index in range(250)
        ])

        default_page = self.client.get(self.list_url)
        self.assertEqual(default_page.status_code, 200)
        self.assertEqual(default_page.data['count'], 250)
        self.assertEqual(len(default_page.data['results']), 100)
        self.assertIsNone(default_page.data['previous'])
        self.assertIn('page=2', default_page.data['next'])
        self.assertIn('page_size=100', default_page.data['next'])

        normal_page = self.client.get(self.list_url, {'page': 2, 'page_size': 25})
        self.assertEqual(normal_page.status_code, 200)
        self.assertEqual(normal_page.data['count'], 250)
        self.assertEqual(len(normal_page.data['results']), 25)
        self.assertIn('page=1', normal_page.data['previous'])
        self.assertIn('page_size=25', normal_page.data['previous'])

        maximum_page = self.client.get(self.list_url, {'page_size': 200})
        self.assertEqual(len(maximum_page.data['results']), 200)
        self.assertEqual(maximum_page.data['count'], 250)

        oversized_page = self.client.get(self.list_url, {'page_size': 999})
        self.assertEqual(oversized_page.status_code, 200)
        self.assertEqual(oversized_page.data['count'], 250)
        self.assertEqual(len(oversized_page.data['results']), 200)
        self.assertIn('page=2', oversized_page.data['next'])
        self.assertIn('page_size=200', oversized_page.data['next'])

        self.add_scheme('999999', 'Match beyond the first page', fund_house='Remote AMC')
        filtered = self.client.get(self.list_url, {'search': 'Match beyond', 'fund_house': 'Remote AMC'})
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.data['count'], 1)
        self.assertEqual(filtered.data['results'][0]['scheme_code'], '999999')

    def test_admin_refresh_requires_wealth_and_trusted_backend_admin_role(self):
        self.assertEqual(self.client.post(reverse('wealth-scheme-catalogue-refresh'), {}, format='json').status_code, 403)
        self.user.role = User.Role.ADMIN
        self.user.save(update_fields=['role'])
        with patch('wealth.views.refresh_scheme_catalogue', return_value={'status': 'SUCCESS', 'inserted': 0, 'updated': 0, 'unchanged': 0}):
            response = self.client.post(reverse('wealth-scheme-catalogue-refresh'), {}, format='json')
        self.assertEqual(response.status_code, 200)

    def test_admin_without_wealth_access_is_denied_and_client_cannot_set_source(self):
        admin = User.objects.create_user(email='admin-no-wealth@example.com', password='Catalogue-123', full_name='No Wealth Admin', role=User.Role.ADMIN)
        client = APIClient()
        client.force_authenticate(admin)
        self.assertEqual(client.post(reverse('wealth-scheme-catalogue-refresh'), {}, format='json').status_code, 403)
        self.user.role = User.Role.ADMIN
        self.user.save(update_fields=['role'])
        with patch('wealth.views.refresh_scheme_catalogue') as refresh:
            response = self.client.post(reverse('wealth-scheme-catalogue-refresh'), {'source_url': 'https://example.com'}, format='json')
        self.assertEqual(response.status_code, 400)
        refresh.assert_not_called()


class SchemeCatalogueApiConcurrencyTests(TransactionTestCase):
    def setUp(self):
        wealth, _ = AppModule.objects.get_or_create(code='wealth', defaults={'name': 'WealthOnCruise'})
        self.user = User.objects.create_user(
            email='catalogue-concurrent@example.com', password='Catalogue-123', full_name='Concurrent User'
        )
        UserModuleAccess.objects.create(user=self.user, module=wealth)

    def test_concurrent_first_catalogue_requests_download_and_import_once(self):
        from django.db import close_old_connections

        active_downloads = 0
        maximum_active_downloads = 0
        state_lock = Lock()
        user_id = self.user.pk
        url = reverse('wealth-scheme-catalogue')

        def delayed_source():
            nonlocal active_downloads, maximum_active_downloads
            with state_lock:
                active_downloads += 1
                maximum_active_downloads = max(maximum_active_downloads, active_downloads)
            sleep(0.05)
            with state_lock:
                active_downloads -= 1
            return catalogue_source()

        def request_catalogue():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(pk=user_id))
                response = client.get(url)
                return response.status_code, response.data.get('count')
            finally:
                close_old_connections()

        with patch('wealth.scheme_catalogue.download_source', side_effect=delayed_source) as download:
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: request_catalogue(), range(2)))

        self.assertEqual(results, [(200, 10), (200, 10)])
        self.assertEqual(maximum_active_downloads, 1)
        download.assert_called_once()
        self.assertEqual(MutualFundScheme.objects.count(), 10)


class WealthMFTransactionApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.wealth, _ = AppModule.objects.get_or_create(
            code='wealth', defaults={'name': 'WealthOnCruise'}
        )
        cls.fund_house = WealthFundHouse.objects.create(name='Exact Name Mutual Fund')

    def setUp(self):
        self.user = User.objects.create_user(
            email='mf-transactions@example.com', password='Transactions-123', full_name='MF Owner'
        )
        self.other_user = User.objects.create_user(
            email='other-mf@example.com', password='Transactions-123', full_name='Other MF Owner'
        )
        UserModuleAccess.objects.create(user=self.user, module=self.wealth)
        UserModuleAccess.objects.create(user=self.other_user, module=self.wealth)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.scheme = self.make_scheme('141226', 'Sample Direct Growth')
        self.other_scheme = self.make_scheme('120603', 'Sample Debt Fund')

    def make_scheme(self, code, name):
        return MutualFundScheme.objects.create(
            scheme_code=code,
            scheme_name=name,
            fund_house=self.fund_house.name,
            fund_house_master=self.fund_house,
            last_seen_at=timezone.now(),
        )

    def transaction_payload(self, scheme_code='141226', *, date='2026-09-30', amount='100.00', **overrides):
        payload = {
            'transaction_type': 'PURCHASE',
            'transaction_date': date,
            'source': 'MANUAL',
            'scheme_code': scheme_code,
            'mf_detail': {
                'units': '5.0000',
                'nav': '20.0000',
                'amount': amount,
                'charges': '0.00',
                'cashflow': '-' + amount,
            },
        }
        payload.update(overrides)
        return payload

    def create_switch_pair(self):
        switch_out = self.transaction_payload(date='2026-10-30')
        switch_out.update(transaction_type='SWITCH_OUT')
        switch_out['mf_detail']['cashflow'] = '100.00'
        switch_in = self.transaction_payload(scheme_code='120603', date='2026-10-30')
        switch_in.update(transaction_type='SWITCH_IN')
        response = self.client.post(
            reverse('wealth-switch-pair'),
            {'switch_out': switch_out, 'switch_in': switch_in}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_catalogue_refresh_maps_only_exact_fund_house_name(self):
        from .scheme_catalogue import refresh_scheme_catalogue

        with patch('wealth.scheme_catalogue.download_source', return_value=catalogue_source()):
            refresh_scheme_catalogue()
        scheme = MutualFundScheme.objects.get(scheme_code='100000')
        self.assertEqual(scheme.fund_house, 'Sample Mutual Fund')
        self.assertEqual(scheme.fund_house_master.name, 'Sample Mutual Fund')
        self.assertFalse(WealthFundHouse.objects.filter(name='Exact Name Mutual Fund').exclude(pk=self.fund_house.pk).exists())

    def test_normalization_migration_keeps_distinct_legacy_labels_reviewable(self):
        from django.apps import apps
        from django.db import connection
        from importlib import import_module
        from types import SimpleNamespace

        lower_name = 'legacy AMC name'
        upper_name = 'Legacy AMC Name'
        lower_scheme = self.make_scheme('810001', 'Legacy lower', )
        lower_scheme.fund_house = lower_name
        lower_scheme.fund_house_master = None
        lower_scheme.save(update_fields=['fund_house', 'fund_house_master'])
        upper_scheme = self.make_scheme('810002', 'Legacy upper')
        upper_scheme.fund_house = upper_name
        upper_scheme.fund_house_master = None
        upper_scheme.save(update_fields=['fund_house', 'fund_house_master'])
        blank_scheme = self.make_scheme('810003', 'Unmatched blank')
        blank_scheme.fund_house = '   '
        blank_scheme.fund_house_master = None
        blank_scheme.save(update_fields=['fund_house', 'fund_house_master'])

        migration = import_module('wealth.migrations.0006_wealth_fund_house_normalization')
        migration.map_exact_fund_house_values(apps, SimpleNamespace(connection=connection))

        lower_scheme.refresh_from_db()
        upper_scheme.refresh_from_db()
        blank_scheme.refresh_from_db()
        self.assertNotEqual(lower_scheme.fund_house_master_id, upper_scheme.fund_house_master_id)
        self.assertEqual(lower_scheme.fund_house_master.name, lower_name)
        self.assertEqual(upper_scheme.fund_house_master.name, upper_name)
        self.assertIsNone(blank_scheme.fund_house_master_id)

    def test_scheme_selection_lazily_creates_one_shared_instrument(self):
        url = reverse('wealth-instruments')
        first = self.client.post(url, {'scheme_code': self.scheme.scheme_code}, format='json')
        second = self.client.post(url, {'scheme_code': self.scheme.scheme_code}, format='json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data['id'], second.data['id'])
        self.assertEqual(WealthInstrument.objects.filter(scheme=self.scheme).count(), 1)
        self.assertEqual(WealthInstrument.objects.filter(scheme=self.other_scheme).count(), 0)

    def test_transactions_support_optional_folio_and_aggregate_or_folio_holdings(self):
        self.scheme.plan_type = MutualFundScheme.PlanType.DIRECT
        self.scheme.option_type = MutualFundScheme.OptionType.GROWTH
        self.scheme.save(update_fields=['plan_type', 'option_type'])
        without_folio = self.client.post(
            reverse('wealth-transactions'), self.transaction_payload(), format='json',
        )
        folio = WealthFolio.objects.create(
            user=self.user, folio_number='123/45', fund_house=self.fund_house,
        )
        with_folio_payload = self.transaction_payload(date='2026-10-30')
        with_folio_payload['folio'] = str(folio.pk)
        with_folio = self.client.post(
            reverse('wealth-transactions'), with_folio_payload, format='json',
        )

        self.assertEqual(without_folio.status_code, 201, without_folio.data)
        self.assertIsNone(without_folio.data['folio'])
        self.assertEqual(without_folio.data['scheme']['plan_type'], 'DIRECT')
        self.assertEqual(without_folio.data['scheme']['option_type'], 'GROWTH')
        historical = next(
            row for row in self.client.get(reverse('wealth-transactions')).data
            if row['id'] == without_folio.data['id']
        )
        self.assertEqual(historical['scheme']['scheme_code'], self.scheme.scheme_code)
        self.assertEqual(historical['scheme']['plan_type'], 'DIRECT')
        self.assertEqual(historical['scheme']['option_type'], 'GROWTH')
        self.assertEqual(with_folio.status_code, 201, with_folio.data)
        self.assertEqual(str(with_folio.data['folio']), str(folio.pk))
        aggregate_rows = self.client.get(reverse('wealth-holdings')).data['holdings']
        self.assertEqual(len(aggregate_rows), 1, aggregate_rows)
        self.assertEqual(aggregate_rows[0]['units'], '10.000000')
        self.assertEqual(aggregate_rows[0]['scheme_code'], self.scheme.scheme_code)
        self.assertEqual(aggregate_rows[0]['plan_type'], 'DIRECT')
        self.assertEqual(aggregate_rows[0]['option_type'], 'GROWTH')
        folio_rows = self.client.get(reverse('wealth-holdings') + '?group_by=folio').data['holdings']
        self.assertEqual(len(folio_rows), 2)
        filtered_folio_holding = self.client.get(
            reverse('wealth-holdings') + f'?folio={folio.pk}',
        ).data['holdings'][0]
        self.assertEqual(filtered_folio_holding['units'], '5.000000')
        self.assertEqual(filtered_folio_holding['invested_cost'], '100.00')
        self.assertEqual(filtered_folio_holding['average_cost_nav'], '20.0000')

    def test_holdings_keep_same_name_variants_separate_by_scheme_code(self):
        self.scheme.scheme_name = 'Same Display Name'
        self.scheme.plan_type = MutualFundScheme.PlanType.DIRECT
        self.scheme.option_type = MutualFundScheme.OptionType.GROWTH
        self.scheme.save(update_fields=['scheme_name', 'plan_type', 'option_type'])
        regular = self.make_scheme('141227', 'Same Display Name')
        regular.plan_type = MutualFundScheme.PlanType.REGULAR
        regular.option_type = MutualFundScheme.OptionType.GROWTH
        regular.save(update_fields=['plan_type', 'option_type'])

        for code in (self.scheme.scheme_code, regular.scheme_code):
            response = self.client.post(
                reverse('wealth-transactions'), self.transaction_payload(scheme_code=code), format='json',
            )
            self.assertEqual(response.status_code, 201, response.data)

        holdings = self.client.get(reverse('wealth-holdings')).data['holdings']
        self.assertEqual(len(holdings), 2)
        self.assertEqual({holding['scheme_code'] for holding in holdings}, {'141226', '141227'})
        self.assertEqual(
            {holding['plan_type'] for holding in holdings},
            {MutualFundScheme.PlanType.DIRECT, MutualFundScheme.PlanType.REGULAR},
        )

    def test_sip_mandate_and_installment_responses_include_catalog_variant_fields(self):
        self.scheme.plan_type = MutualFundScheme.PlanType.DIRECT
        self.scheme.option_type = MutualFundScheme.OptionType.IDCW
        self.scheme.save(update_fields=['plan_type', 'option_type'])
        mandate = self.make_sip_mandate(status=WealthSIPMandate.Status.PAUSED)

        mandate_row = next(
            row for row in self.client.get(reverse('wealth-sip-mandates')).data
            if row['id'] == str(mandate.pk)
        )
        self.assertEqual(mandate_row['plan_type'], 'DIRECT')
        self.assertEqual(mandate_row['option_type'], 'IDCW')

        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('100.00'),
        )
        installment_row = next(
            row for row in self.client.get(reverse('wealth-sip-installments'), {'status': 'PENDING'}).data
            if row['id'] == str(installment.pk)
        )
        self.assertEqual(installment_row['scheme_code'], self.scheme.scheme_code)
        self.assertEqual(installment_row['plan_type'], 'DIRECT')
        self.assertEqual(installment_row['option_type'], 'IDCW')

    def test_folio_must_match_scheme_fund_house(self):
        other_house = WealthFundHouse.objects.create(name='Different AMC')
        folio = WealthFolio.objects.create(
            user=self.user, folio_number='wrong-amc', fund_house=other_house,
        )
        payload = self.transaction_payload()
        payload['folio'] = str(folio.pk)
        response = self.client.post(reverse('wealth-transactions'), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('folio', response.data)
        self.assertEqual(WealthTransaction.objects.count(), 0)

    def test_detail_rejects_amount_inconsistent_with_units_and_nav(self):
        independent_amount = self.transaction_payload(amount='10000.00')
        independent_amount['mf_detail'].update(
            units='78.1412', nav='127.9765', charges='7.25', cashflow='-10000.00',
        )
        response = self.client.post(reverse('wealth-transactions'), independent_amount, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('amount', response.data['mf_detail'])

        independent_amount['mf_detail']['amount'] = '10000.24'
        response = self.client.post(reverse('wealth-transactions'), independent_amount, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['mf_detail']['amount'], '10000.24')
        self.assertEqual(response.data['mf_detail']['cashflow'], '-10000.00')
        self.assertEqual(response.data['mf_detail']['units'], '78.1412')
        self.assertEqual(response.data['mf_detail']['nav'], '127.9765')

        wrong_direction = self.transaction_payload()
        wrong_direction['mf_detail']['cashflow'] = '100.00'
        response = self.client.post(reverse('wealth-transactions'), wrong_direction, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('mf_detail', response.data)

    def test_decimal_precision_is_four_places_for_units_nav_and_two_for_currency(self):
        self.assertEqual(WealthMFTransactionDetail._meta.get_field('units').decimal_places, 4)
        self.assertEqual(WealthMFTransactionDetail._meta.get_field('nav').decimal_places, 4)
        for field in ('amount', 'charges', 'cashflow'):
            self.assertEqual(WealthMFTransactionDetail._meta.get_field(field).decimal_places, 2)

        invalid_currency_precision = self.transaction_payload()
        invalid_currency_precision['mf_detail']['amount'] = '100.001'
        response = self.client.post(
            reverse('wealth-transactions'), invalid_currency_precision, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('mf_detail', response.data)

    def test_cashflow_equations_include_charges_on_create(self):
        purchase = self.transaction_payload()
        purchase['mf_detail'].update(charges='12.34', cashflow='-112.34')
        created = self.client.post(reverse('wealth-transactions'), purchase, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['mf_detail']['amount'], '100.00')
        self.assertEqual(created.data['mf_detail']['charges'], '12.34')
        self.assertEqual(created.data['mf_detail']['cashflow'], '-112.34')

        invalid_purchase = self.transaction_payload(date='2026-10-01')
        invalid_purchase['mf_detail'].update(charges='12.34', cashflow='-100.01')
        rejected_purchase = self.client.post(
            reverse('wealth-transactions'), invalid_purchase, format='json',
        )
        self.assertEqual(rejected_purchase.status_code, 400)
        self.assertIn('cashflow', rejected_purchase.data['mf_detail'])

        redemption = self.transaction_payload(scheme_code='120603', date='2026-10-22')
        redemption.update(transaction_type='REDEMPTION', source='MANUAL')
        redemption['mf_detail'].update(charges='4.56', cashflow='95.44')
        redeemed = self.client.post(reverse('wealth-transactions'), redemption, format='json')
        self.assertEqual(redeemed.status_code, 201, redeemed.data)
        self.assertEqual(redeemed.data['mf_detail']['amount'], '100.00')
        self.assertEqual(redeemed.data['mf_detail']['charges'], '4.56')
        self.assertEqual(redeemed.data['mf_detail']['cashflow'], '95.44')

        invalid_redemption = self.transaction_payload(scheme_code='120603', date='2026-10-23')
        invalid_redemption.update(transaction_type='REDEMPTION', source='MANUAL')
        invalid_redemption['mf_detail'].update(charges='4.56', cashflow='87.65')
        rejected_redemption = self.client.post(
            reverse('wealth-transactions'), invalid_redemption, format='json',
        )
        self.assertEqual(rejected_redemption.status_code, 400)
        self.assertIn('cashflow', rejected_redemption.data['mf_detail'])

    def test_serializer_valid_maximum_decimal_product_returns_validation_error(self):
        maximum_payload = self.transaction_payload(amount='9999999999999999.99')
        maximum_payload['mf_detail'].update(
            units='999999999999999999.9999',
            nav='99999999999999.9999',
            cashflow='-9999999999999999.99',
        )
        response = self.client.post(
            reverse('wealth-transactions'), maximum_payload, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('amount', response.data['mf_detail'])

    def test_direct_orm_detail_save_runs_application_validation(self):
        instrument = WealthInstrument.objects.create(scheme=self.scheme)
        transaction_record = WealthTransaction.objects.create(
            user=self.user,
            instrument=instrument,
            transaction_type=WealthTransaction.TransactionType.PURCHASE,
            transaction_date=date(2026, 9, 30),
        )
        detail = WealthMFTransactionDetail(
            transaction=transaction_record,
            units=Decimal('5.0000'),
            nav=Decimal('20.0000'),
            amount=Decimal('100.00'),
            charges=Decimal('0.00'),
            cashflow=Decimal('100.00'),
        )
        with self.assertRaises(DjangoValidationError):
            detail.save()

    def test_partial_patch_merges_each_supplied_detail_field_with_persisted_values(self):
        created = self.client.post(
            reverse('wealth-transactions'), self.transaction_payload(), format='json',
        )
        self.assertEqual(created.status_code, 201, created.data)
        detail_url = reverse('wealth-transaction-detail', args=[created.data['id']])
        for field, value in (('units', '5.1234'), ('nav', '20.1234'), ('amount', '101.25')):
            response = self.client.patch(
                detail_url, {'mf_detail': {field: value}}, format='json',
            )
            self.assertEqual(response.status_code, 400, (field, response.data))
            self.assertIn('amount', response.data['mf_detail'])

        response = self.client.patch(
            detail_url,
            {'mf_detail': {
                'units': '5.0000', 'nav': '21.0000', 'amount': '105.00',
                'charges': '1.25', 'cashflow': '-106.25',
            }},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['mf_detail']['amount'], '105.00')

        wrong_cashflow = self.client.patch(
            detail_url, {'mf_detail': {'cashflow': '-106.24'}}, format='json',
        )
        self.assertEqual(wrong_cashflow.status_code, 400)
        self.assertIn('cashflow', wrong_cashflow.data['mf_detail'])

        wrong_charges = self.client.patch(
            detail_url, {'mf_detail': {'charges': '2.00'}}, format='json',
        )
        self.assertEqual(wrong_charges.status_code, 400)
        self.assertIn('cashflow', wrong_charges.data['mf_detail'])

        valid_change = self.client.patch(
            detail_url,
            {'mf_detail': {'charges': '2.00', 'cashflow': '-107.00'}}, format='json',
        )
        self.assertEqual(valid_change.status_code, 200, valid_change.data)
        self.assertEqual(valid_change.data['mf_detail']['cashflow'], '-107.00')

    def test_purchase_redemption_and_sip_are_accounted_with_explicit_cash_direction(self):
        purchase = self.transaction_payload(date='2026-09-30', source='SIP')
        created = self.client.post(reverse('wealth-transactions'), purchase, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['transaction_type'], 'PURCHASE')
        self.assertEqual(created.data['source'], 'SIP')
        self.assertEqual(created.data['mf_detail']['cashflow'], '-100.00')

        invalid_sip = self.transaction_payload(date='2026-09-30', source='SIP')
        invalid_sip['mf_detail']['units'] = '4.9999'
        response = self.client.post(reverse('wealth-transactions'), invalid_sip, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('units', response.data['mf_detail'])

        invalid_sip_cashflow = self.transaction_payload(date='2026-09-30', source='SIP')
        invalid_sip_cashflow['mf_detail'].update(charges='1.00', cashflow='-100.00')
        response = self.client.post(
            reverse('wealth-transactions'), invalid_sip_cashflow, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('cashflow', response.data['mf_detail'])

        redemption = self.transaction_payload(scheme_code='120603', date='2026-10-22')
        redemption.update(transaction_type='REDEMPTION', source='MANUAL')
        redemption['mf_detail']['cashflow'] = '100.00'
        redeemed = self.client.post(reverse('wealth-transactions'), redemption, format='json')
        self.assertEqual(redeemed.status_code, 201, redeemed.data)
        self.assertEqual(redeemed.data['transaction_type'], 'REDEMPTION')
        self.assertEqual(redeemed.data['mf_detail']['cashflow'], '100.00')

    def make_sip_mandate(self, **overrides):
        values = {
            'user': self.user,
            'scheme': self.scheme,
            'monthly_amount': Decimal('100.00'),
            'sip_day': 20,
            'start_date': date(2026, 1, 15),
            'generate_from_date': date(2026, 1, 15),
        }
        values.update(overrides)
        return WealthSIPMandate.objects.create(**values)

    def test_sip_confirmation_endpoint_uses_base_row_lock_and_confirms_purchase_once(self):
        mandate = self.make_sip_mandate()
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('1000.00'),
        )
        url = reverse('wealth-sip-confirm-installment', args=[installment.pk])
        payload = {
            'actual_date': '2026-01-20',
            'actual_nav': '30.0100',
            'actual_charges': '0.12',
            'charges_source': WealthMFTransactionDetail.ChargesSource.MANUAL,
        }

        response = self.client.post(url, payload, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        purchase = WealthTransaction.objects.get(source=WealthTransaction.Source.SIP)
        self.assertEqual(purchase.mf_detail.units, Decimal('33.3182'))
        self.assertEqual(purchase.mf_detail.nav, Decimal('30.0100'))
        self.assertEqual(purchase.mf_detail.amount, Decimal('999.88'))
        self.assertEqual(purchase.mf_detail.charges, Decimal('0.12'))
        self.assertEqual(purchase.mf_detail.cashflow, Decimal('-1000.00'))
        holdings = self.client.get(reverse('wealth-holdings')).data['holdings']
        self.assertEqual(holdings[0]['units'], '33.3182')
        self.assertEqual(holdings[0]['invested_cost'], '1000.00')
        installment.refresh_from_db()
        self.assertEqual(installment.status, WealthSIPInstallment.Status.CONFIRMED)
        self.assertEqual(installment.amount, Decimal('1000.00'))
        self.assertEqual(installment.transaction_id, purchase.pk)
        self.assertEqual(installment.transaction_id_snapshot, purchase.pk)

        repeated = self.client.post(url, payload, format='json')
        self.assertEqual(repeated.status_code, 409)
        self.assertEqual(WealthTransaction.objects.filter(source=WealthTransaction.Source.SIP).count(), 1)

    def test_sip_confirmation_rejects_invalid_nav_or_charges_without_mutating_installment(self):
        mandate = self.make_sip_mandate()
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('1000.00'),
        )
        url = reverse('wealth-sip-confirm-installment', args=[installment.pk])
        for invalid_field, invalid_value in (
            ('actual_nav', '0.0000'), ('actual_charges', '-0.01'), ('actual_charges', '1000.01'),
        ):
            payload = {
                'actual_date': '2026-01-20', 'actual_nav': '30.0100',
            }
            payload[invalid_field] = invalid_value
            response = self.client.post(url, payload, format='json')
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn(invalid_field, response.data)
        installment.refresh_from_db()
        self.assertEqual(installment.status, WealthSIPInstallment.Status.PENDING)
        self.assertEqual(installment.amount, Decimal('1000.00'))
        self.assertFalse(WealthTransaction.objects.filter(source=WealthTransaction.Source.SIP).exists())

    def test_user_cannot_confirm_another_users_sip_installment(self):
        mandate = self.make_sip_mandate()
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('1000.00'),
        )
        other_client = APIClient()
        other_client.force_authenticate(self.other_user)
        response = other_client.post(
            reverse('wealth-sip-confirm-installment', args=[installment.pk]),
            {'actual_date': '2026-01-20', 'actual_nav': '30.0100'}, format='json',
        )
        self.assertEqual(response.status_code, 404)
        installment.refresh_from_db()
        self.assertEqual(installment.status, WealthSIPInstallment.Status.PENDING)
        self.assertFalse(WealthTransaction.objects.filter(source=WealthTransaction.Source.SIP).exists())

    def test_deleting_confirmed_sip_purchase_restores_pending_installment_and_allows_one_reconfirmation(self):
        mandate = self.make_sip_mandate()
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('1000.00'),
        )
        confirmation_url = reverse('wealth-sip-confirm-installment', args=[installment.pk])
        confirmed = self.client.post(
            confirmation_url,
            {'actual_date': '2026-01-20', 'actual_nav': '30.0100'},
            format='json',
        )
        self.assertEqual(confirmed.status_code, 201, confirmed.data)
        old_transaction_id = confirmed.data['transaction']['id']
        deleted = self.client.delete(reverse('wealth-transaction-detail', args=[old_transaction_id]))
        self.assertEqual(deleted.status_code, 204)

        mandate.refresh_from_db()
        installment.refresh_from_db()
        self.assertEqual(mandate.status, WealthSIPMandate.Status.ACTIVE)
        self.assertEqual(installment.status, WealthSIPInstallment.Status.PENDING)
        self.assertIsNone(installment.transaction_id)
        self.assertEqual(str(installment.transaction_id_snapshot), old_transaction_id)

        mandates = self.client.get(reverse('wealth-sip-mandates'))
        self.assertEqual(mandates.status_code, 200, mandates.data)
        self.assertEqual(next(row for row in mandates.data if row['id'] == str(mandate.pk))['status'], 'ACTIVE')

        audit = self.client.get(reverse('wealth-transaction-audit', args=[old_transaction_id]))
        self.assertEqual(audit.status_code, 200, audit.data)
        self.assertEqual([row['action'] for row in audit.data], ['DELETED', 'CREATED'])
        self.assertEqual(audit.data[0]['before']['mf_detail']['nav'], '30.0100')

        for _ in range(2):
            pending = self.client.get(reverse('wealth-sip-installments'), {'status': 'PENDING'})
            self.assertEqual(pending.status_code, 200, pending.data)
            pending_row = next(row for row in pending.data if row['id'] == str(installment.pk))
            self.assertEqual(pending_row['status'], 'PENDING')
            self.assertEqual(pending_row['transaction_id_snapshot'], old_transaction_id)
            self.assertEqual(sum(row['id'] == str(installment.pk) for row in pending.data), 1)
        self.assertEqual(WealthSIPInstallment.objects.filter(
            mandate=mandate, scheduled_date=installment.scheduled_date,
        ).count(), 1)

        reconfirmed = self.client.post(
            confirmation_url,
            {'actual_date': '2026-01-20', 'actual_nav': '31.2500'},
            format='json',
        )
        self.assertEqual(reconfirmed.status_code, 201, reconfirmed.data)
        duplicate = self.client.post(
            confirmation_url,
            {'actual_date': '2026-01-20', 'actual_nav': '31.2500'},
            format='json',
        )
        self.assertEqual(duplicate.status_code, 409)
        installment.refresh_from_db()
        self.assertEqual(installment.status, WealthSIPInstallment.Status.CONFIRMED)
        self.assertEqual(installment.transaction_id, reconfirmed.data['transaction']['id'])
        self.assertEqual(WealthTransaction.objects.filter(source=WealthTransaction.Source.SIP).count(), 1)

    def test_deleting_manual_purchase_does_not_change_sip_mandate_or_pending_installment(self):
        mandate = self.make_sip_mandate()
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('100.00'),
        )
        manual = self.client.post(
            reverse('wealth-transactions'), self.transaction_payload(source='MANUAL'), format='json',
        )
        self.assertEqual(manual.status_code, 201, manual.data)
        deleted = self.client.delete(reverse('wealth-transaction-detail', args=[manual.data['id']]))
        self.assertEqual(deleted.status_code, 204)

        mandate.refresh_from_db()
        installment.refresh_from_db()
        self.assertEqual(mandate.status, WealthSIPMandate.Status.ACTIVE)
        self.assertEqual(installment.status, WealthSIPInstallment.Status.PENDING)
        self.assertIsNone(installment.transaction_id)
        self.assertIsNone(installment.transaction_id_snapshot)

    def test_sip_pause_resume_and_owner_scope(self):
        today = timezone.localdate()
        month_start = date(today.year, today.month, 1)
        mandate = self.make_sip_mandate(
            start_date=month_start, generate_from_date=month_start, sip_day=1,
        )
        url = reverse('wealth-sip-mandate-detail', args=[mandate.pk])
        paused = self.client.patch(url, {'status': 'PAUSED'}, format='json')
        self.assertEqual(paused.status_code, 200, paused.data)
        self.assertEqual(paused.data['status'], WealthSIPMandate.Status.PAUSED)

        resumed = self.client.patch(url, {'status': 'ACTIVE'}, format='json')
        self.assertEqual(resumed.status_code, 200, resumed.data)
        self.assertEqual(resumed.data['status'], WealthSIPMandate.Status.ACTIVE)

        other_client = APIClient()
        other_client.force_authenticate(self.other_user)
        forbidden = other_client.patch(url, {'status': 'PAUSED'}, format='json')
        self.assertEqual(forbidden.status_code, 404)
        mandate.refresh_from_db()
        self.assertEqual(mandate.status, WealthSIPMandate.Status.ACTIVE)

    def test_postgres_sip_pause_query_locks_only_mandate_row(self):
        if connection.vendor != 'postgresql':
            self.skipTest('PostgreSQL SELECT FOR UPDATE SQL assertion requires PostgreSQL.')
        mandate = self.make_sip_mandate()
        with CaptureQueriesContext(connection) as captured:
            response = self.client.patch(
                reverse('wealth-sip-mandate-detail', args=[mandate.pk]),
                {'status': 'PAUSED'}, format='json',
            )
        self.assertEqual(response.status_code, 200, response.data)
        lock_sql = [query['sql'].upper() for query in captured.captured_queries if 'FOR UPDATE' in query['sql'].upper()]
        self.assertTrue(lock_sql)
        self.assertTrue(any('FOR UPDATE OF ' in sql for sql in lock_sql), lock_sql)

    def test_invalid_resume_does_not_change_paused_mandate_or_installments(self):
        cursor = date(2026, 1, 31)
        mandate = self.make_sip_mandate(
            status=WealthSIPMandate.Status.PAUSED,
            generated_through=cursor,
        )
        response = self.client.patch(
            reverse('wealth-sip-mandate-detail', args=[mandate.pk]),
            {'status': 'ACTIVE', 'monthly_amount': '0.00'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('monthly_amount', response.data)
        mandate.refresh_from_db()
        self.assertEqual(mandate.status, WealthSIPMandate.Status.PAUSED)
        self.assertEqual(mandate.generated_through, cursor)
        self.assertFalse(WealthSIPInstallment.objects.filter(mandate=mandate).exists())

    def test_delete_sip_mandate_removes_pending_installments(self):
        mandate = self.make_sip_mandate()
        WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('100.00'),
        )
        WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 2, 20), amount=Decimal('100.00'),
        )
        listed_mandate = next(
            row for row in self.client.get(reverse('wealth-sip-mandates')).data
            if row['id'] == str(mandate.pk)
        )
        self.assertTrue(listed_mandate['can_delete'])
        response = self.client.delete(reverse('wealth-sip-mandate-detail', args=[mandate.pk]))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(WealthSIPMandate.objects.filter(pk=mandate.pk).exists())
        self.assertFalse(WealthSIPInstallment.objects.filter(mandate_id=mandate.pk).exists())

    def test_sip_mandate_with_surviving_confirmed_purchase_cannot_be_deleted(self):
        mandate = self.make_sip_mandate()
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('100.00'),
        )
        confirmed = self.client.post(
            reverse('wealth-sip-confirm-installment', args=[installment.pk]),
            {'actual_date': '2026-01-20', 'actual_nav': '20.0000'}, format='json',
        )
        self.assertEqual(confirmed.status_code, 201, confirmed.data)

        listed_mandate = next(
            row for row in self.client.get(reverse('wealth-sip-mandates')).data
            if row['id'] == str(mandate.pk)
        )
        self.assertFalse(listed_mandate['can_delete'])
        self.assertIn('linked confirmed purchases', listed_mandate['delete_block_reason'])

        response = self.client.delete(reverse('wealth-sip-mandate-detail', args=[mandate.pk]))
        self.assertEqual(response.status_code, 400)
        self.assertIn('linked confirmed purchases', response.data['detail'])
        self.assertTrue(WealthSIPMandate.objects.filter(pk=mandate.pk).exists())
        self.assertTrue(WealthSIPInstallment.objects.filter(pk=installment.pk, transaction__isnull=False).exists())

    def test_deleted_sip_purchase_audit_survives_eligible_mandate_deletion(self):
        mandate = self.make_sip_mandate()
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('100.00'),
        )
        confirmed = self.client.post(
            reverse('wealth-sip-confirm-installment', args=[installment.pk]),
            {'actual_date': '2026-01-20', 'actual_nav': '20.0000'}, format='json',
        )
        transaction_id = confirmed.data['transaction']['id']
        self.assertEqual(confirmed.status_code, 201, confirmed.data)
        self.assertEqual(self.client.delete(reverse('wealth-transaction-detail', args=[transaction_id])).status_code, 204)

        deleted_mandate = self.client.delete(reverse('wealth-sip-mandate-detail', args=[mandate.pk]))
        self.assertEqual(deleted_mandate.status_code, 204)
        self.assertFalse(WealthSIPInstallment.objects.filter(mandate=mandate).exists())
        self.assertEqual(
            set(WealthTransactionAudit.objects.filter(transaction_id_snapshot=transaction_id).values_list('action', flat=True)),
            {WealthTransactionAudit.Action.CREATED, WealthTransactionAudit.Action.DELETED},
        )

    def test_user_cannot_delete_another_users_sip_mandate(self):
        mandate = self.make_sip_mandate()
        other_client = APIClient()
        other_client.force_authenticate(self.other_user)
        response = other_client.delete(reverse('wealth-sip-mandate-detail', args=[mandate.pk]))
        self.assertEqual(response.status_code, 404)
        self.assertTrue(WealthSIPMandate.objects.filter(pk=mandate.pk, user=self.user).exists())

    def test_folio_delete_rules_cover_history_and_active_or_paused_sip_mandates(self):
        folio = WealthFolio.objects.create(user=self.user, folio_number='history-1')
        purchase = self.transaction_payload(folio=str(folio.pk), date='2026-09-01')
        created = self.client.post(reverse('wealth-transactions'), purchase, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        redemption = self.transaction_payload(folio=str(folio.pk), date='2026-09-02')
        redemption.update(transaction_type='REDEMPTION')
        redemption['mf_detail']['cashflow'] = '100.00'
        redeemed = self.client.post(reverse('wealth-transactions'), redemption, format='json')
        self.assertEqual(redeemed.status_code, 201, redeemed.data)

        folio_in_list = next(row for row in self.client.get(reverse('wealth-folios')).data if row['id'] == str(folio.pk))
        self.assertFalse(folio_in_list['can_delete'])
        self.assertIn('transaction history', folio_in_list['delete_block_reason'])
        blocked = self.client.delete(reverse('wealth-folio-detail', args=[folio.pk]))
        self.assertEqual(blocked.status_code, 400)
        self.assertIn('transaction history', blocked.data['detail'])

        for state in (WealthSIPMandate.Status.ACTIVE, WealthSIPMandate.Status.PAUSED):
            with self.subTest(status=state):
                linked = WealthFolio.objects.create(user=self.user, folio_number=f'mandate-{state.lower()}')
                self.make_sip_mandate(folio=linked, status=state)
                list_entry = next(row for row in self.client.get(reverse('wealth-folios')).data if row['id'] == str(linked.pk))
                self.assertFalse(list_entry['can_delete'])
                self.assertIn('SIP mandates', list_entry['delete_block_reason'])
                rejected = self.client.delete(reverse('wealth-folio-detail', args=[linked.pk]))
                self.assertEqual(rejected.status_code, 400)
                self.assertIn('SIP mandates', rejected.data['detail'])

    def test_empty_folio_can_be_deleted_and_foreign_folio_is_scoped(self):
        empty = WealthFolio.objects.create(user=self.user, folio_number='empty-1')
        empty_row = next(row for row in self.client.get(reverse('wealth-folios')).data if row['id'] == str(empty.pk))
        self.assertTrue(empty_row['can_delete'])
        self.assertIsNone(empty_row['delete_block_reason'])

        other_folio = WealthFolio.objects.create(user=self.other_user, folio_number='private-empty')
        foreign = self.client.delete(reverse('wealth-folio-detail', args=[other_folio.pk]))
        self.assertEqual(foreign.status_code, 404)
        self.assertTrue(WealthFolio.objects.filter(pk=other_folio.pk, user=self.other_user).exists())

        deleted = self.client.delete(reverse('wealth-folio-detail', args=[empty.pk]))
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(WealthFolio.objects.filter(pk=empty.pk).exists())

    def test_folio_can_be_deleted_after_transactions_and_mandates_are_removed(self):
        folio = WealthFolio.objects.create(user=self.user, folio_number='reusable-1')
        mandate = self.make_sip_mandate(folio=folio)
        WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('100.00'),
        )
        purchase = self.transaction_payload(folio=str(folio.pk), date='2026-09-01')
        created = self.client.post(reverse('wealth-transactions'), purchase, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(self.client.delete(reverse('wealth-transaction-detail', args=[created.data['id']])).status_code, 204)
        self.assertEqual(self.client.delete(reverse('wealth-sip-mandate-detail', args=[mandate.pk])).status_code, 204)
        response = self.client.delete(reverse('wealth-folio-detail', args=[folio.pk]))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(WealthFolio.objects.filter(pk=folio.pk).exists())

    def test_pending_installment_date_must_be_within_mandate_dates(self):
        mandate = self.make_sip_mandate(end_date=date(2026, 2, 1))
        installment = WealthSIPInstallment.objects.create(
            mandate=mandate, scheduled_date=date(2026, 1, 20), amount=Decimal('100.00'),
        )
        url = reverse('wealth-sip-installment-detail', args=[installment.pk])

        before_start = self.client.patch(url, {'scheduled_date': '2026-01-14'}, format='json')
        self.assertEqual(before_start.status_code, 400)
        self.assertIn('scheduled_date', before_start.data)

        valid = self.client.patch(url, {'scheduled_date': '2026-01-25'}, format='json')
        self.assertEqual(valid.status_code, 200, valid.data)
        self.assertEqual(valid.data['scheduled_date'], '2026-01-25')

        after_end = self.client.patch(url, {'scheduled_date': '2026-02-02'}, format='json')
        self.assertEqual(after_end.status_code, 400)
        self.assertIn('scheduled_date', after_end.data)

    def test_invalid_pause_request_does_not_generate_or_advance_installments(self):
        mandate = self.make_sip_mandate(
            start_date=date(2020, 1, 1),
            generate_from_date=date(2020, 1, 1),
            sip_day=1,
        )
        response = self.client.patch(
            reverse('wealth-sip-mandate-detail', args=[mandate.pk]),
            {'status': 'PAUSED', 'scheme_code': self.scheme.scheme_code, 'monthly_amount': '0.00'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('monthly_amount', response.data)
        mandate.refresh_from_db()
        self.assertEqual(mandate.status, WealthSIPMandate.Status.ACTIVE)
        self.assertIsNone(mandate.generated_through)
        self.assertFalse(WealthSIPInstallment.objects.filter(mandate=mandate).exists())

    def test_switch_endpoint_creates_paired_legs_with_shared_group_and_audits(self):
        switch_date = '2026-10-30'
        switch_out = self.transaction_payload(date=switch_date)
        switch_out.update(transaction_type='SWITCH_OUT')
        switch_out['mf_detail']['cashflow'] = '100.00'
        switch_in = self.transaction_payload(scheme_code='120603', date=switch_date)
        switch_in.update(transaction_type='SWITCH_IN')
        switch_pair = self.client.post(
            reverse('wealth-switch-pair'),
            {'switch_out': switch_out, 'switch_in': switch_in},
            format='json',
        )
        self.assertEqual(switch_pair.status_code, 201, switch_pair.data)
        self.assertEqual(switch_pair.data['switch_out']['switch_group_id'], switch_pair.data['switch_in']['switch_group_id'])
        self.assertEqual(WealthTransaction.objects.filter(switch_group_id=switch_pair.data['switch_group_id']).count(), 2)
        self.assertEqual(WealthTransactionAudit.objects.count(), 2)
        single_leg_delete = self.client.delete(reverse(
            'wealth-transaction-detail', args=[switch_pair.data['switch_out']['id']],
        ))
        self.assertEqual(single_leg_delete.status_code, 400)
        self.assertEqual(WealthTransaction.objects.filter(switch_group_id=switch_pair.data['switch_group_id']).count(), 2)

    def test_switch_pair_rolls_back_when_second_leg_creation_fails(self):
        switch_date = '2026-10-30'
        switch_out = self.transaction_payload(date=switch_date)
        switch_out.update(transaction_type='SWITCH_OUT')
        switch_out['mf_detail']['cashflow'] = '100.00'
        switch_in = self.transaction_payload(scheme_code='120603', date=switch_date)
        switch_in.update(transaction_type='SWITCH_IN')
        payload = {'switch_out': switch_out, 'switch_in': switch_in}
        from . import views

        original_create = views._create_switch_leg
        calls = 0

        def fail_second_leg(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError('forced second-leg failure')
            return original_create(*args, **kwargs)

        with patch('wealth.views._create_switch_leg', side_effect=fail_second_leg):
            with self.assertRaises(RuntimeError):
                self.client.post(reverse('wealth-switch-pair'), payload, format='json')
        self.assertEqual(WealthTransaction.objects.count(), 0)
        self.assertEqual(WealthMFTransactionDetail.objects.count(), 0)
        self.assertEqual(WealthTransactionAudit.objects.count(), 0)

    def test_switch_pair_edit_is_atomic_and_invalid_second_leg_leaves_both_legs_unchanged(self):
        pair = self.create_switch_pair()
        group_id = pair['switch_group_id']
        url = reverse('wealth-switch-group-detail', args=[group_id])
        switch_out = self.transaction_payload(date='2026-11-01')
        switch_out.update(transaction_type='SWITCH_OUT', notes='updated source')
        switch_out['mf_detail'].update(charges='5.00', cashflow='95.00')
        switch_in = self.transaction_payload(scheme_code='120603', date='2026-11-01')
        switch_in.update(transaction_type='SWITCH_IN', notes='updated destination')
        switch_in['mf_detail'].update(charges='2.00', cashflow='-102.00')

        updated = self.client.patch(url, {'switch_out': switch_out, 'switch_in': switch_in}, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['switch_out']['notes'], 'updated source')
        self.assertEqual(updated.data['switch_in']['notes'], 'updated destination')
        self.assertEqual(WealthTransactionAudit.objects.filter(action=WealthTransactionAudit.Action.UPDATED).count(), 2)

        invalid_out = {**switch_out, 'notes': 'must not persist'}
        invalid_in = {**switch_in, 'mf_detail': {**switch_in['mf_detail'], 'cashflow': '100.00'}}
        rejected = self.client.patch(url, {'switch_out': invalid_out, 'switch_in': invalid_in}, format='json')
        self.assertEqual(rejected.status_code, 400, rejected.data)
        source = WealthTransaction.objects.get(switch_group_id=group_id, transaction_type='SWITCH_OUT')
        destination = WealthTransaction.objects.get(switch_group_id=group_id, transaction_type='SWITCH_IN')
        self.assertEqual(source.notes, 'updated source')
        self.assertEqual(destination.notes, 'updated destination')
        self.assertEqual(WealthTransactionAudit.objects.filter(action=WealthTransactionAudit.Action.UPDATED).count(), 2)

    def test_switch_edit_logs_display_number_for_each_invalid_folio_leg_and_keeps_pair_unchanged(self):
        for invalid_leg in ('switch_out', 'switch_in'):
            with self.subTest(invalid_leg=invalid_leg):
                pair = self.create_switch_pair()
                group_id = pair['switch_group_id']
                switch_out = self.transaction_payload(date='2026-11-02', notes='must not persist')
                switch_out.update(transaction_type='SWITCH_OUT')
                switch_out['mf_detail']['cashflow'] = '100.00'
                switch_in = self.transaction_payload(scheme_code='120603', date='2026-11-02', notes='must not persist')
                switch_in.update(transaction_type='SWITCH_IN')
                payload = {'switch_out': switch_out, 'switch_in': switch_in}
                payload[invalid_leg]['folio'] = '46549589'

                with self.assertLogs('django.server', level='WARNING') as captured:
                    response = self.client.patch(
                        reverse('wealth-switch-group-detail', args=[group_id]), payload, format='json',
                    )

                self.assertEqual(response.status_code, 400)
                self.assertIn(invalid_leg, response.data)
                self.assertIn('folio', response.data[invalid_leg])
                output = '\n'.join(captured.output)
                self.assertIn('switch_edit_validation_failed', output)
                self.assertIn(str(group_id), output)
                self.assertIn(f'"{invalid_leg}"', output)
                self.assertIn('"raw_folio": "46549589"', output)
                self.assertIn('"python_type": "str"', output)
                self.assertIn('"folio_classification": "display_number"', output)

                source = WealthTransaction.objects.get(
                    switch_group_id=group_id, transaction_type=WealthTransaction.TransactionType.SWITCH_OUT,
                )
                destination = WealthTransaction.objects.get(
                    switch_group_id=group_id, transaction_type=WealthTransaction.TransactionType.SWITCH_IN,
                )
                self.assertEqual(source.notes, '')
                self.assertEqual(destination.notes, '')
                self.assertEqual(WealthTransactionAudit.objects.filter(action=WealthTransactionAudit.Action.UPDATED).count(), 0)

    def test_switch_edit_accepts_owned_uuid_folios_and_logs_resolution(self):
        pair = self.create_switch_pair()
        folio = WealthFolio.objects.create(
            user=self.user, folio_number='46549589', fund_house=self.fund_house,
        )
        switch_out = self.transaction_payload(date='2026-11-03')
        switch_out.update(transaction_type='SWITCH_OUT')
        switch_out['mf_detail']['cashflow'] = '100.00'
        switch_in = self.transaction_payload(scheme_code='120603', date='2026-11-03')
        switch_in.update(transaction_type='SWITCH_IN')
        switch_out['folio'] = str(folio.pk)
        switch_in['folio'] = str(folio.pk)

        with self.assertLogs('django.server', level='INFO') as captured:
            response = self.client.patch(
                reverse('wealth-switch-group-detail', args=[pair['switch_group_id']]),
                {'switch_out': switch_out, 'switch_in': switch_in}, format='json',
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['switch_out']['folio'], str(folio.pk))
        self.assertEqual(response.data['switch_in']['folio'], str(folio.pk))
        output = '\n'.join(captured.output)
        self.assertIn('switch_edit_validation_succeeded', output)
        self.assertIn(str(folio.pk), output)
        self.assertIn('"ownership_check": "passed"', output)
        self.assertIn('"amc_check": "passed"', output)

    def test_switch_pair_delete_removes_both_legs_and_keeps_both_audit_snapshots(self):
        pair = self.create_switch_pair()
        group_id = pair['switch_group_id']
        deleted = self.client.delete(reverse('wealth-switch-group-detail', args=[group_id]))
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(WealthTransaction.objects.filter(switch_group_id=group_id).exists())
        audit_rows = WealthTransactionAudit.objects.filter(action=WealthTransactionAudit.Action.DELETED)
        self.assertEqual(audit_rows.count(), 2)
        self.assertEqual({row.before['transaction_type'] for row in audit_rows}, {'SWITCH_OUT', 'SWITCH_IN'})

    def test_two_distinct_scheme_141226_purchases_on_september_and_october_30(self):
        september = self.transaction_payload(date='2026-09-30')
        october = self.transaction_payload(date='2026-10-30')
        september['mf_detail'].update(units='10.0001', nav='999.9900', amount='10000.00', cashflow='-10000.00')
        october['mf_detail'].update(units='9.8765', nav='1012.3456', amount='10000.00', cashflow='-10000.00')
        first = self.client.post(reverse('wealth-transactions'), september, format='json')
        second = self.client.post(reverse('wealth-transactions'), october, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(first.data['id'], second.data['id'])
        self.assertEqual(first.data['scheme']['scheme_code'], '141226')
        self.assertEqual(second.data['scheme']['scheme_code'], '141226')
        self.assertEqual(WealthTransaction.objects.filter(
            instrument__scheme__scheme_code='141226',
            transaction_date__in=[date(2026, 9, 30), date(2026, 10, 30)],
        ).count(), 2)

    def test_transaction_audit_keeps_before_after_and_deleted_snapshots(self):
        created = self.client.post(reverse('wealth-transactions'), self.transaction_payload(), format='json')
        transaction_id = created.data['id']
        detail_url = reverse('wealth-transaction-detail', args=[transaction_id])
        updated = self.client.patch(detail_url, {'notes': 'updated note'}, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        audit = self.client.get(reverse('wealth-transaction-audit', args=[transaction_id]))
        self.assertEqual([item['action'] for item in audit.data], ['UPDATED', 'CREATED'])
        self.assertEqual(audit.data[0]['before']['notes'], '')
        self.assertEqual(audit.data[0]['after']['notes'], 'updated note')

        deleted = self.client.delete(detail_url)
        self.assertEqual(deleted.status_code, 204)
        latest = WealthTransactionAudit.objects.get(action=WealthTransactionAudit.Action.DELETED)
        self.assertIsNone(latest.transaction_id)
        self.assertEqual(str(latest.transaction_id_snapshot), transaction_id)
        self.assertEqual(latest.before['notes'], 'updated note')
        preserved = self.client.get(reverse('wealth-transaction-audit', args=[transaction_id]))
        self.assertEqual(preserved.status_code, 200)
        self.assertEqual([item['action'] for item in preserved.data], ['DELETED', 'UPDATED', 'CREATED'])

    def test_user_cannot_read_another_users_transaction_or_folio(self):
        other_folio = WealthFolio.objects.create(user=self.other_user, folio_number='other-folio')
        other_instrument = WealthInstrument.objects.create(scheme=self.scheme)
        other_transaction = WealthTransaction.objects.create(
            user=self.other_user,
            instrument=other_instrument,
            transaction_type=WealthTransaction.TransactionType.PURCHASE,
            transaction_date=date(2026, 9, 30),
            folio=other_folio,
        )
        WealthMFTransactionDetail.objects.create(
            transaction=other_transaction, units='5', nav='20', amount='100', cashflow='-100',
        )
        self.assertEqual(self.client.get(reverse('wealth-transactions')).data, [])
        response = self.client.patch(
            reverse('wealth-transaction-detail', args=[other_transaction.pk]),
            {'notes': 'unauthorized'}, format='json',
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get(reverse('wealth-folios')).data, [])

    def test_user_without_wealth_access_cannot_access_transaction_api(self):
        user = User.objects.create_user(
            email='no-wealth-mf@example.com', password='Transactions-123', full_name='No Wealth',
        )
        client = APIClient()
        client.force_authenticate(user)
        response = client.get(reverse('wealth-transactions'))
        self.assertEqual(response.status_code, 403)
