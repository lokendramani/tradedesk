from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from users.models import AppModule, UserModuleAccess
from .models import CashFlowCategory, CashFlowEntry, CashFlowProfile


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
