from decimal import Decimal
from datetime import date
import ssl
from unittest.mock import MagicMock, patch
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import sleep

from django.contrib.auth import get_user_model
from django.db import IntegrityError, OperationalError, transaction
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from users.models import AppModule, UserModuleAccess
from .models import CashFlowCategory, CashFlowEntry, CashFlowProfile, WealthMilestone


User = get_user_model()


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
