import json
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from django.urls import reverse
from rest_framework.test import APIClient

from users.models import AppModule, UserModuleAccess
from .holdings import positive_held_scheme_ids
from .models import (
    MutualFundScheme,
    WealthFolio,
    WealthInstrument,
    WealthMFNAVHistory,
    WealthMFNAVHistoryLoad,
    WealthMFNAVUpdateLock,
    WealthMFNAVUpdateRun,
    WealthMFTransactionDetail,
    WealthTransaction,
)
from .nav_updates import (
    NAVUpdateBusy,
    NAVUpdateError,
    ensure_scheme_history_loaded,
    _nav_update_lock_queryset,
    parse_amfi_navall,
    parse_mfapi_history,
    run_amfi_nav_update,
)


User = get_user_model()


class WealthNAVTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.wealth_module, _ = AppModule.objects.get_or_create(
            code='wealth', defaults={'name': 'WealthOnCruise'},
        )

    def setUp(self):
        self.user = User.objects.create_user(
            email='nav-user@example.com', password='NAV-test-123', full_name='NAV User',
        )
        self.grant_wealth(self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def grant_wealth(self, user):
        UserModuleAccess.objects.create(user=user, module=self.wealth_module)

    def scheme(self, code='104772', name='NAV Test Fund'):
        return MutualFundScheme.objects.create(
            scheme_code=code,
            scheme_name=name,
            last_seen_at='2026-01-01T00:00:00Z',
        )

    def transaction(self, scheme, transaction_type='PURCHASE', units='2.5000', folio=None):
        instrument, _ = WealthInstrument.objects.get_or_create(scheme=scheme)
        is_switch = transaction_type in {
            WealthTransaction.TransactionType.SWITCH_IN,
            WealthTransaction.TransactionType.SWITCH_OUT,
        }
        is_bonus = transaction_type == WealthTransaction.TransactionType.BONUS
        instance = WealthTransaction.objects.create(
            user=self.user,
            instrument=instrument,
            folio=folio,
            transaction_type=transaction_type,
            transaction_date=date(2026, 1, 2),
            source=WealthTransaction.Source.MANUAL,
            switch_group_id=uuid4() if is_switch else None,
        )
        credit = transaction_type in {
            WealthTransaction.TransactionType.REDEMPTION,
            WealthTransaction.TransactionType.SWITCH_OUT,
        }
        WealthMFTransactionDetail.objects.create(
            transaction=instance,
            units=Decimal(units),
            nav=Decimal('10.0000'),
            amount=Decimal('0.00') if is_bonus else Decimal('25.00'),
            charges=Decimal('0.00'),
            cashflow=Decimal('0.00') if is_bonus else (Decimal('25.00') if credit else Decimal('-25.00')),
        )
        return instance

    def nav(self, scheme, nav_date, value, source=WealthMFNAVHistory.Source.AMFI):
        return WealthMFNAVHistory.objects.create(
            scheme=scheme,
            nav_date=nav_date,
            nav=Decimal(value),
            source=source,
        )


class WealthMFNAVModelTests(WealthNAVTestCase):
    def test_nav_history_has_shared_scheme_date_uniqueness_and_four_decimal_precision(self):
        scheme = self.scheme()
        first = self.nav(scheme, date(2025, 12, 1), '123.4567')
        self.assertEqual(first.nav, Decimal('123.4567'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.nav(scheme, date(2025, 12, 1), '120.0000')

    def test_nav_model_rejects_non_positive_values_and_future_dates(self):
        scheme = self.scheme()
        invalid = WealthMFNAVHistory(
            scheme=scheme,
            nav_date=date(2025, 12, 1),
            nav=Decimal('0'),
            source=WealthMFNAVHistory.Source.MFAPI,
        )
        with self.assertRaises(ValidationError):
            invalid.full_clean()
        future = WealthMFNAVHistory(
            scheme=scheme,
            nav_date=date(2999, 1, 1),
            nav=Decimal('1.0000'),
            source=WealthMFNAVHistory.Source.MFAPI,
        )
        with self.assertRaises(ValidationError):
            future.full_clean()

    def test_mfapi_history_parser_validates_metadata_and_preserves_decimal_nav(self):
        payload = {
            'status': 'SUCCESS',
            'meta': {'scheme_code': 104772},
            'data': [
                {'date': '02-01-2025', 'nav': '123.4567'},
                {'date': '01-01-2025', 'nav': '122.1234'},
            ],
        }
        parsed = parse_mfapi_history(payload, '104772')
        self.assertEqual(parsed[0], {'nav_date': date(2025, 1, 1), 'nav': Decimal('122.1234')})
        with self.assertRaises(NAVUpdateError):
            parse_mfapi_history(payload, '120403')

    def test_mfapi_parser_rejects_empty_invalid_and_unsuccessful_responses(self):
        for payload in (
            {'status': 'SUCCESS', 'meta': {'scheme_code': '104772'}, 'data': []},
            {'status': 'SUCCESS', 'meta': {'scheme_code': '104772'}, 'data': [{'date': 'bad', 'nav': '1'}]},
            {'status': 'FAILED', 'meta': {'scheme_code': '104772'}, 'data': []},
        ):
            with self.subTest(payload=payload), self.assertRaises(NAVUpdateError):
                parse_mfapi_history(payload, '104772')

    @patch('wealth.nav_updates._download_text')
    def test_history_api_lazily_loads_once_and_then_serves_stored_records(self, download):
        scheme = self.scheme()
        download.return_value = json.dumps({
            'status': 'SUCCESS',
            'meta': {'scheme_code': scheme.scheme_code},
            'data': [
                {'date': '02-01-2025', 'nav': '123.4567'},
                {'date': '01-01-2025', 'nav': '122.1234'},
            ],
        })
        url = reverse('wealth-scheme-nav-history', args=[scheme.scheme_code])
        first = self.client.get(url)
        second = self.client.get(url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['results'][0]['nav'], '122.1234')
        self.assertEqual(second.data['results'], first.data['results'])
        self.assertEqual(download.call_count, 1)
        self.assertTrue(WealthMFNAVHistoryLoad.objects.get(scheme=scheme).history_loaded_at)

    @patch('wealth.nav_updates._download_text', side_effect=NAVUpdateError('network failure'))
    def test_failed_history_load_is_not_marked_complete_and_can_retry(self, download):
        scheme = self.scheme()
        url = reverse('wealth-scheme-nav-history', args=[scheme.scheme_code])
        first = self.client.get(url)
        second = self.client.get(url)
        self.assertEqual((first.status_code, second.status_code), (502, 502))
        self.assertEqual(download.call_count, 2)
        state = WealthMFNAVHistoryLoad.objects.get(scheme=scheme)
        self.assertIsNone(state.history_loaded_at)
        self.assertTrue(state.error_summary)

    @patch('wealth.nav_updates._download_text', return_value='not-json')
    def test_invalid_json_history_response_remains_retryable(self, download):
        scheme = self.scheme()
        response = self.client.get(reverse('wealth-scheme-nav-history', args=[scheme.scheme_code]))
        self.assertEqual(response.status_code, 502)
        state = WealthMFNAVHistoryLoad.objects.get(scheme=scheme)
        self.assertIsNone(state.history_loaded_at)
        self.assertTrue(state.error_summary)
        download.assert_called_once()

    def test_history_api_filters_chronologically_and_rejects_invalid_dates(self):
        scheme = self.scheme()
        self.nav(scheme, date(2025, 1, 3), '3.0000')
        self.nav(scheme, date(2025, 1, 1), '1.0000')
        WealthMFNAVHistoryLoad.objects.create(scheme=scheme, history_loaded_at='2025-01-04T00:00:00Z')
        url = reverse('wealth-scheme-nav-history', args=[scheme.scheme_code])
        response = self.client.get(url, {'from': '2025-01-02'})
        invalid = self.client.get(url, {'from': '01-02-2025'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['nav_date'] for item in response.data['results']], ['2025-01-03'])
        self.assertEqual(invalid.status_code, 400)

    def test_history_api_unknown_scheme_returns_404(self):
        response = self.client.get(reverse('wealth-scheme-nav-history', args=['does-not-exist']))
        self.assertEqual(response.status_code, 404)

    def test_holdings_api_returns_latest_nav_and_currency_rounded_market_value(self):
        scheme = self.scheme()
        self.transaction(scheme)
        self.nav(scheme, date(2025, 12, 1), '90.0000')
        self.nav(scheme, date(2025, 12, 2), '100.1234')
        response = self.client.get(reverse('wealth-holdings'), {'group_by': 'aggregate'})
        self.assertEqual(response.status_code, 200)
        row = response.data['holdings'][0]
        self.assertEqual(row['latest_nav'], '100.1234')
        self.assertEqual(row['nav_date'], '2025-12-02')
        self.assertEqual(row['market_value'], '250.31')

    def test_folio_holdings_use_shared_nav_and_missing_nav_is_null(self):
        folio = WealthFolio.objects.create(user=self.user, folio_number='FOLIO-1')
        scheme = self.scheme()
        self.transaction(scheme, folio=folio)
        response = self.client.get(reverse('wealth-holdings'), {'group_by': 'folio'})
        row = response.data['holdings'][0]
        self.assertEqual(row['folio_number'], folio.folio_number)
        self.assertIsNone(row['latest_nav'])
        self.assertIsNone(row['nav_date'])
        self.assertIsNone(row['market_value'])

    def test_positive_and_negative_folios_can_net_to_zero_without_hiding_folio_anomaly(self):
        scheme = self.scheme('cross-folio')
        positive_folio = WealthFolio.objects.create(user=self.user, folio_number='POSITIVE-FOLIO')
        negative_folio = WealthFolio.objects.create(user=self.user, folio_number='NEGATIVE-FOLIO')
        self.transaction(scheme, units='5.0000', folio=positive_folio)
        self.transaction(
            scheme,
            transaction_type='REDEMPTION',
            units='5.0000',
            folio=negative_folio,
        )

        aggregate = self.client.get(reverse('wealth-holdings'), {'group_by': 'aggregate'})
        folio_wise = self.client.get(reverse('wealth-holdings'), {'group_by': 'folio'})
        folio_rows = {row['folio_number']: row for row in folio_wise.data['holdings']}

        self.assertNotIn(scheme.scheme_code, [row['scheme_code'] for row in aggregate.data['holdings']])
        self.assertEqual(set(positive_held_scheme_ids()), {scheme.pk})
        self.assertEqual(folio_rows['POSITIVE-FOLIO']['units'], '5.000000')
        self.assertIsNone(folio_rows['POSITIVE-FOLIO']['position_warning'])
        self.assertEqual(folio_rows['NEGATIVE-FOLIO']['units'], '-5.000000')
        self.assertEqual(folio_rows['NEGATIVE-FOLIO']['position_warning'], 'NEGATIVE_NET_UNITS')

    def test_negative_only_folio_is_reported_but_not_nav_eligible(self):
        scheme = self.scheme('negative-only')
        folio = WealthFolio.objects.create(user=self.user, folio_number='NEGATIVE-ONLY-FOLIO')
        self.transaction(scheme, transaction_type='REDEMPTION', units='1.0000', folio=folio)

        response = self.client.get(reverse('wealth-holdings'), {'group_by': 'folio'})

        row = response.data['holdings'][0]
        self.assertEqual(row['units'], '-1.000000')
        self.assertEqual(row['position_warning'], 'NEGATIVE_NET_UNITS')
        self.assertEqual(positive_held_scheme_ids(), [])

    def test_unassigned_positive_holdings_are_nav_eligible_and_visible(self):
        scheme = self.scheme('unassigned')
        self.transaction(scheme, units='3.0000')

        response = self.client.get(reverse('wealth-holdings'), {'group_by': 'folio'})

        row = response.data['holdings'][0]
        self.assertIsNone(row['folio_id'])
        self.assertIsNone(row['position_warning'])
        self.assertEqual(positive_held_scheme_ids(), [scheme.pk])

    def test_user_without_wealth_grant_cannot_read_nav_history_or_holdings(self):
        other = User.objects.create_user(
            email='no-nav-access@example.com', password='NAV-test-123', full_name='No Access',
        )
        client = APIClient()
        client.force_authenticate(other)
        self.assertEqual(client.get(reverse('wealth-holdings')).status_code, 403)
        self.assertEqual(client.get(reverse('wealth-scheme-nav-history', args=['104772'])).status_code, 403)


class WealthAMFINAVTests(WealthNAVTestCase):
    @staticmethod
    def source(rows):
        header = 'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date'
        return '\n'.join([header] + [f'{code};INF000000000;INF000000001;Scheme {code};{nav};{nav_date}' for code, nav, nav_date in rows])

    def test_initial_lock_query_locks_only_the_singleton_row(self):
        queryset = _nav_update_lock_queryset()

        self.assertTrue(queryset.query.select_for_update)
        self.assertEqual(queryset.query.select_for_update_of, ('self',))
        self.assertIn('active_run', queryset.query.select_related)

    def test_amfi_parser_extracts_nav_and_date_and_marks_bad_scheme_rows(self):
        rows = [(str(code), '100.1234', '02-Jan-2025') for code in range(10)]
        rows.append(('999', 'N.A.', 'bad-date'))
        parsed, rejected = parse_amfi_navall(self.source(rows))
        self.assertEqual(parsed['0'], {'nav_date': date(2025, 1, 2), 'nav': Decimal('100.1234')})
        self.assertIn('999', rejected)

    def test_held_schemes_respect_signed_units_folios_and_unassigned_positions(self):
        positive = self.scheme('positive')
        zero = self.scheme('zero')
        negative = self.scheme('negative')
        switch_source = self.scheme('switch-source')
        switch_target = self.scheme('switch-target')
        self.transaction(positive, units='5.0000')
        self.transaction(positive, transaction_type='BONUS', units='1.0000')
        self.transaction(zero, units='5.0000')
        self.transaction(zero, transaction_type='REDEMPTION', units='5.0000')
        self.transaction(negative, transaction_type='REDEMPTION', units='1.0000')
        self.transaction(switch_source, units='2.0000')
        self.transaction(switch_source, transaction_type='SWITCH_OUT', units='2.0000')
        self.transaction(switch_target, transaction_type='SWITCH_IN', units='2.0000')
        self.assertEqual(set(positive_held_scheme_ids()), {positive.pk, switch_target.pk})

    @patch('wealth.nav_updates._download_text')
    def test_amfi_update_only_upserts_held_scheme_and_marks_amfi_precedence(self, download):
        scheme = self.scheme('120403')
        self.transaction(scheme)
        existing = self.nav(scheme, date(2025, 1, 2), '99.0000', WealthMFNAVHistory.Source.MFAPI)
        rows = [(str(code), '100.1234', '02-Jan-2025') for code in range(10)]
        rows[0] = (scheme.scheme_code, '101.5678', '02-Jan-2025')
        download.return_value = self.source(rows)

        result = run_amfi_nav_update(triggered_by=self.user)

        existing.refresh_from_db()
        self.assertEqual(download.call_count, 1)
        self.assertEqual(result['status'], WealthMFNAVUpdateRun.Status.SUCCESS)
        self.assertEqual((result['held_schemes'], result['inserted'], result['updated']), (1, 0, 1))
        self.assertEqual(existing.nav, Decimal('101.5678'))
        self.assertEqual(existing.source, WealthMFNAVHistory.Source.AMFI)
        download.return_value = json.dumps({
            'status': 'SUCCESS',
            'meta': {'scheme_code': scheme.scheme_code},
            'data': [{'date': '02-01-2025', 'nav': '88.0000'}],
        })
        self.assertTrue(ensure_scheme_history_loaded(scheme))
        self.assertFalse(ensure_scheme_history_loaded(scheme))
        existing.refresh_from_db()
        self.assertEqual(existing.nav, Decimal('101.5678'))
        self.assertEqual(existing.source, WealthMFNAVHistory.Source.AMFI)
        state = WealthMFNAVHistoryLoad.objects.get(scheme=scheme)
        self.assertIsNotNone(state.history_loaded_at)
        self.assertEqual(download.call_count, 2)

    @patch('wealth.nav_updates._download_text', return_value='corrupt;file')
    def test_invalid_amfi_file_does_not_change_existing_history_and_run_is_failed(self, download):
        scheme = self.scheme('120403')
        self.transaction(scheme)
        existing = self.nav(scheme, date(2025, 1, 2), '99.0000')
        result = run_amfi_nav_update(triggered_by=self.user)
        existing.refresh_from_db()
        self.assertEqual(result['status'], WealthMFNAVUpdateRun.Status.FAILED)
        self.assertEqual(result['inserted'], 0)
        self.assertEqual(existing.nav, Decimal('99.0000'))

    @patch('wealth.nav_updates._download_text')
    def test_missing_held_scheme_preserves_old_history_and_is_reported_partial(self, download):
        scheme = self.scheme('120403')
        self.transaction(scheme)
        existing = self.nav(scheme, date(2025, 1, 2), '99.0000')
        download.return_value = self.source([
            (str(code), '100.1234', '02-Jan-2025') for code in range(10)
        ])
        result = run_amfi_nav_update(triggered_by=self.user)
        existing.refresh_from_db()
        self.assertEqual(result['status'], WealthMFNAVUpdateRun.Status.PARTIAL)
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(existing.nav, Decimal('99.0000'))

    @patch('wealth.views.run_amfi_nav_update')
    def test_manual_trigger_requires_admin_and_wealth_access(self, run_update):
        url = reverse('wealth-nav-update-admin')
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 403)
        self.user.role = User.Role.ADMIN
        self.user.save(update_fields=['role'])
        summary = self.client.get(url)
        self.assertEqual(summary.status_code, 200)
        self.assertGreater(summary.data['stale_after_seconds'], 0)
        run_update.return_value = {
            'run_id': '00000000-0000-0000-0000-000000000001',
            'status': 'SUCCESS', 'held_schemes': 0, 'inserted': 0, 'updated': 0,
            'skipped': 0, 'failed': 0, 'error_summary': '',
        }
        response = self.client.post(url, {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'SUCCESS')
        run_update.assert_called_once_with(triggered_by=self.user)

    def test_admin_status_exposes_backend_stale_lease_and_running_age(self):
        self.user.role = User.Role.ADMIN
        self.user.save(update_fields=['role'])
        run = WealthMFNAVUpdateRun.objects.create(triggered_by=self.user)
        run.started_at = timezone.now() - timedelta(minutes=31)
        run.save(update_fields=['started_at'])

        response = self.client.get(reverse('wealth-nav-update-admin'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['stale_after_seconds'], 1800)
        self.assertGreaterEqual(response.data['latest_run']['run_age_seconds'], 1860)

    def test_manual_trigger_rejects_unauthenticated_and_non_wealth_admin(self):
        url = reverse('wealth-nav-update-admin')
        self.assertEqual(APIClient().post(url, {}, format='json').status_code, 401)
        admin = User.objects.create_user(
            email='admin-no-wealth-nav@example.com', password='NAV-test-123',
            full_name='Admin without Wealth', role=User.Role.ADMIN,
        )
        client = APIClient()
        client.force_authenticate(admin)
        self.assertEqual(client.post(url, {}, format='json').status_code, 403)

    @patch('wealth.nav_updates._process_update_lock')
    def test_duplicate_process_local_trigger_is_rejected(self, process_lock):
        process_lock.acquire.return_value = False
        with self.assertRaises(NAVUpdateBusy) as raised:
            run_amfi_nav_update(triggered_by=self.user)
        self.assertEqual(str(raised.exception), 'An AMFI NAV update is already running.')
        self.assertFalse(WealthMFNAVUpdateRun.objects.exists())

    def test_database_active_run_rejects_duplicate_trigger(self):
        active = WealthMFNAVUpdateRun.objects.create(triggered_by=self.user)
        WealthMFNAVUpdateLock.objects.create(pk=1, active_run=active)
        with self.assertRaises(NAVUpdateBusy):
            run_amfi_nav_update(triggered_by=self.user)
        self.assertEqual(WealthMFNAVUpdateRun.objects.count(), 1)
