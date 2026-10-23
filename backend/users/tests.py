import os
import subprocess
import sys
from uuid import uuid4
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from portfolio.models import Portfolio
from trades.models import Trade
from .models import AppModule, UserModuleAccess
from .throttling import load_auth_throttle_rates, validate_auth_throttle_rate
from .views import login, refresh_token, register

User = get_user_model()


class ModuleAccessApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tradedesk, _ = AppModule.objects.get_or_create(
            code='tradedesk', defaults={'name': 'TradeDesk'}
        )
        cls.wealth, _ = AppModule.objects.get_or_create(
            code='wealth', defaults={'name': 'WealthOnCruise'}
        )

    def setUp(self):
        self.user = User.objects.create_user(
            email='trader@example.com', password='Strong-pass-123', full_name='Test Trader'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def grant(self, module, user=None):
        return UserModuleAccess.objects.create(user=user or self.user, module=module)

    def protected_paths(self):
        portfolio_id = uuid4()
        trade_id = uuid4()
        routes = [
            ('portfolio-list', {}),
            ('portfolio-detail', {'pk': portfolio_id}),
            ('trade-list', {'portfolio_id': portfolio_id}),
            ('trade-detail', {'portfolio_id': portfolio_id, 'pk': trade_id}),
            ('trade-close', {'portfolio_id': portfolio_id, 'pk': trade_id}),
            ('trade-import', {'portfolio_id': portfolio_id}),
            ('trade-bulk', {'portfolio_id': portfolio_id}),
            ('trade-clear', {'portfolio_id': portfolio_id}),
            ('trade-sample-csv', {'portfolio_id': portfolio_id}),
            ('trade-export', {'portfolio_id': portfolio_id}),
            ('trade-stats', {'portfolio_id': portfolio_id}),
            ('equity-curve', {'portfolio_id': portfolio_id}),
            ('monthly-pnl', {'portfolio_id': portfolio_id}),
            ('closed-months', {'portfolio_id': portfolio_id}),
            ('monthly-segment-breakdown', {'portfolio_id': portfolio_id}),
            ('trade-chat', {'portfolio_id': portfolio_id}),
            ('mf-import', {}),
            ('mf-dashboard', {}),
            ('mf-schemes', {}),
            ('mf-transactions', {}),
            ('mf-delete', {}),
            ('sip-upload', {}),
            ('sip-trades', {}),
            ('sip-close-trade', {'pk': trade_id}),
            ('sip-holdings', {}),
            ('sip-booked-pl', {}),
            ('sip-sell', {}),
            ('sip-dashboard', {}),
            ('sip-refresh', {}),
            ('sip-clear', {}),
            ('sip-etf-master-list', {}),
            ('sip-etf-master-detail', {'ticker': 'TEST'}),
        ]
        return [reverse(name, kwargs=kwargs) for name, kwargs in routes]

    def test_all_tradedesk_api_routes_require_an_active_tradedesk_grant(self):
        for path in self.protected_paths():
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403)

    def test_wealth_only_user_cannot_call_tradedesk_api(self):
        self.grant(self.wealth)
        self.assertEqual(self.client.get(reverse('portfolio-list')).status_code, 403)

    def test_tradedesk_grant_allows_existing_api_contract(self):
        self.grant(self.tradedesk)
        response = self.client.get(reverse('portfolio-list'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 0)
        self.assertEqual(response.data['results'], [])

    def test_grant_allows_portfolio_trade_write_and_csv_import_export(self):
        self.grant(self.tradedesk)
        portfolio_response = self.client.post(reverse('portfolio-list'), {
            'name': 'Primary',
            'type': 'TRADING',
            'starting_capital': '1000.00',
            'worst_case_capital': '500.00',
        }, format='json')
        self.assertEqual(portfolio_response.status_code, 201)
        portfolio_id = portfolio_response.data['id']

        trade_response = self.client.post(
            reverse('trade-list', kwargs={'portfolio_id': portfolio_id}),
            {
                'scrip_name': 'ACME',
                'segment': 'EQUITY',
                'direction': 'LONG',
                'entry_date': '2025-01-02',
                'entry_price': '100.00',
                'quantity': '2.0000',
            },
            format='json',
        )
        self.assertEqual(trade_response.status_code, 201)
        self.assertEqual(trade_response.data['scrip_name'], 'ACME')

        upload = SimpleUploadedFile(
            'trades.csv', b'Symbol,Date,Price,Qty\nBETA,2025-01-03,50,3\n',
            content_type='text/csv',
        )
        import_response = self.client.post(
            reverse('trade-import', kwargs={'portfolio_id': portfolio_id}),
            {
                'file': upload,
                'scripName': 'Symbol',
                'entryDate': 'Date',
                'entryPrice': 'Price',
                'quantity': 'Qty',
            },
            format='multipart',
        )
        self.assertEqual(import_response.status_code, 200)
        self.assertEqual(import_response.data['data']['imported'], 1)

        export_response = self.client.get(
            reverse('trade-export', kwargs={'portfolio_id': portfolio_id})
        )
        sample_response = self.client.get(
            reverse('trade-sample-csv', kwargs={'portfolio_id': portfolio_id})
        )
        self.assertEqual(export_response.status_code, 200)
        self.assertIn('ACME', export_response.content.decode())
        self.assertEqual(sample_response.status_code, 200)

    def test_both_module_user_can_use_tradedesk_api(self):
        self.grant(self.tradedesk)
        self.grant(self.wealth)
        self.assertEqual(self.client.get(reverse('portfolio-list')).status_code, 200)

    def test_revocation_and_module_deactivation_take_effect_immediately(self):
        grant = self.grant(self.tradedesk)
        path = reverse('portfolio-list')
        self.assertEqual(self.client.get(path).status_code, 200)

        grant.revoked_at = timezone.now()
        grant.revoked_by = self.user
        grant.save(update_fields=['revoked_at', 'revoked_by'])
        self.assertEqual(self.client.get(path).status_code, 403)

        replacement = self.grant(self.tradedesk)
        self.tradedesk.is_active = False
        self.tradedesk.save(update_fields=['is_active'])
        self.assertEqual(self.client.get(path).status_code, 403)
        replacement.refresh_from_db()
        self.assertIsNone(replacement.revoked_at)

    def test_server_ignores_stale_module_claims_after_revocation(self):
        grant = self.grant(self.tradedesk)
        access = AccessToken.for_user(self.user)
        access['modules'] = ['tradedesk']
        self.client.force_authenticate(user=None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        path = reverse('portfolio-list')
        self.assertEqual(self.client.get(path).status_code, 200)

        grant.revoked_at = timezone.now()
        grant.save(update_fields=['revoked_at'])
        self.assertEqual(self.client.get(path).status_code, 403)

    def test_regrant_preserves_revoked_history(self):
        original = self.grant(self.tradedesk)
        original.revoked_at = timezone.now()
        original.revoked_by = self.user
        original.save(update_fields=['revoked_at', 'revoked_by'])

        replacement = self.grant(self.tradedesk)
        self.assertNotEqual(original.pk, replacement.pk)
        self.assertEqual(UserModuleAccess.objects.filter(user=self.user, module=self.tradedesk).count(), 2)
        original.refresh_from_db()
        self.assertEqual(original.revoked_by, self.user)

    def test_current_user_reports_only_active_modules_without_grant(self):
        response = self.client.get(reverse('auth-me'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['data']['modules'], [])

    def test_current_user_reports_active_modules_and_ignores_revoked_or_inactive(self):
        self.grant(self.tradedesk)
        self.grant(self.wealth)
        response = self.client.get(reverse('auth-me'))
        self.assertEqual(response.data['data']['modules'], ['tradedesk', 'wealth'])

        wealth_grant = UserModuleAccess.objects.get(user=self.user, module=self.wealth)
        wealth_grant.revoked_at = timezone.now()
        wealth_grant.save(update_fields=['revoked_at'])
        self.tradedesk.is_active = False
        self.tradedesk.save(update_fields=['is_active'])
        response = self.client.get(reverse('auth-me'))
        self.assertEqual(response.data['data']['modules'], [])

    def test_new_registration_gets_no_module_and_can_use_auth_endpoints(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(reverse('auth-register'), {
            'email': 'new@example.com',
            'password': 'Strong-pass-123',
            'full_name': 'New User',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['data']['user']['modules'], [])

        new_user = User.objects.get(email='new@example.com')
        self.assertFalse(UserModuleAccess.objects.filter(user=new_user).exists())
        self.client.force_authenticate(new_user)
        self.assertEqual(self.client.get(reverse('auth-me')).status_code, 200)
        self.assertEqual(self.client.get(reverse('portfolio-list')).status_code, 403)

        self.client.force_authenticate(user=None)
        login = self.client.post(reverse('auth-login'), {
            'email': new_user.email,
            'password': 'Strong-pass-123',
        }, format='json')
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.data['data']['user']['modules'], [])
        refresh = self.client.post(reverse('auth-refresh'), {
            'refresh': login.data['data']['refresh'],
        }, format='json')
        self.assertEqual(refresh.status_code, 200)
        self.assertEqual(AccessToken(refresh.data['data']['access'])['modules'], [])

    def test_login_and_refresh_include_modules_as_non_authoritative_claims(self):
        UserModuleAccess.objects.create(user=self.user, module=self.wealth)
        self.client.force_authenticate(user=None)
        login = self.client.post(reverse('auth-login'), {
            'email': self.user.email,
            'password': 'Strong-pass-123',
        }, format='json')
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.data['data']['user']['modules'], ['wealth'])

        refresh = self.client.post(reverse('auth-refresh'), {
            'refresh': login.data['data']['refresh'],
        }, format='json')
        self.assertEqual(refresh.status_code, 200)
        self.assertEqual(AccessToken(refresh.data['data']['access'])['modules'], ['wealth'])

        grant = UserModuleAccess.objects.get(user=self.user, module=self.wealth)
        grant.revoked_at = timezone.now()
        grant.save(update_fields=['revoked_at'])
        refresh = self.client.post(reverse('auth-refresh'), {
            'refresh': login.data['data']['refresh'],
        }, format='json')
        self.assertEqual(AccessToken(refresh.data['data']['access'])['modules'], [])

    def test_duplicate_active_grants_are_rejected_but_regrant_after_revoke_is_allowed(self):
        self.grant(self.tradedesk)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.grant(self.tradedesk)

        active_grant = UserModuleAccess.objects.get(user=self.user, module=self.tradedesk)
        active_grant.revoked_at = timezone.now()
        active_grant.save(update_fields=['revoked_at'])
        self.grant(self.tradedesk)

    def test_deleting_subject_and_actors_preserves_audited_identity_snapshots(self):
        grantor = User.objects.create_user(
            email='grantor@example.com', password='Strong-pass-123', full_name='Grant Actor'
        )
        revoker = User.objects.create_user(
            email='revoker@example.com', password='Strong-pass-123', full_name='Revoke Actor'
        )
        grant = UserModuleAccess.objects.create(
            user=self.user, module=self.tradedesk, granted_by=grantor
        )
        grant.revoked_by = revoker
        grant.revoked_at = timezone.now()
        grant.save(update_fields=['revoked_at', 'revoked_by'])

        subject_id = self.user.pk
        grantor_id = grantor.pk
        revoker_id = revoker.pk
        self.user.delete()
        grantor.delete()
        revoker.delete()

        grant.refresh_from_db()
        self.assertIsNone(grant.user_id)
        self.assertIsNone(grant.granted_by_id)
        self.assertIsNone(grant.revoked_by_id)
        self.assertEqual(grant.subject_user_id_snapshot, subject_id)
        self.assertEqual(grant.subject_email_snapshot, 'trader@example.com')
        self.assertEqual(grant.subject_name_snapshot, 'Test Trader')
        self.assertEqual(grant.grantor_id_snapshot, grantor_id)
        self.assertEqual(grant.grantor_email_snapshot, 'grantor@example.com')
        self.assertEqual(grant.grantor_name_snapshot, 'Grant Actor')
        self.assertEqual(grant.revoker_id_snapshot, revoker_id)
        self.assertEqual(grant.revoker_email_snapshot, 'revoker@example.com')
        self.assertEqual(grant.revoker_name_snapshot, 'Revoke Actor')

    def test_two_users_cannot_read_each_others_portfolios_or_trades(self):
        self.grant(self.tradedesk)
        other_user = User.objects.create_user(
            email='other@example.com', password='Strong-pass-123', full_name='Other Trader'
        )
        own_portfolio = Portfolio.objects.create(user=self.user, name='Own Portfolio')
        other_portfolio = Portfolio.objects.create(user=other_user, name='Other Portfolio')
        own_trade = Trade.objects.create(
            portfolio=own_portfolio,
            scrip_name='OWN', segment='EQUITY', entry_date='2025-01-01',
            entry_price='10', quantity='1',
        )
        other_trade = Trade.objects.create(
            portfolio=other_portfolio,
            scrip_name='SECRET', segment='EQUITY', entry_date='2025-01-01',
            entry_price='20', quantity='1',
        )

        portfolios = self.client.get(reverse('portfolio-list'), {'user_id': other_user.pk})
        self.assertEqual(portfolios.status_code, 200)
        self.assertEqual([row['id'] for row in portfolios.data['results']], [str(own_portfolio.pk)])

        own_trades = self.client.get(reverse(
            'trade-list', kwargs={'portfolio_id': own_portfolio.pk}
        ))
        self.assertEqual(own_trades.status_code, 200)
        self.assertEqual([row['id'] for row in own_trades.data['results']], [str(own_trade.pk)])

        other_trades = self.client.get(reverse(
            'trade-list', kwargs={'portfolio_id': other_portfolio.pk}
        ))
        self.assertEqual(other_trades.status_code, 404)
        self.assertNotIn(other_trade.scrip_name, str(own_trades.data))


class AuthThrottleTests(TestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_auth_views_have_separate_scopes_and_configurable_defaults(self):
        self.assertEqual(login.cls.throttle_scope, 'auth_login')
        self.assertEqual(register.cls.throttle_scope, 'auth_register')
        self.assertEqual(refresh_token.cls.throttle_scope, 'auth_refresh')
        self.assertEqual(settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'], {
            'auth_register': '5/hour',
            'auth_login': '5/minute',
            'auth_refresh': '60/minute',
        })

    def test_missing_environment_values_use_the_existing_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                load_auth_throttle_rates(lambda name, default: os.environ.get(name, default)),
                {
                    'auth_register': '5/hour',
                    'auth_login': '5/minute',
                    'auth_refresh': '60/minute',
                },
            )

    def test_valid_custom_environment_values_are_preserved(self):
        custom_values = {
            'AUTH_REGISTER_THROTTLE_RATE': '2/hour',
            'AUTH_LOGIN_THROTTLE_RATE': '8/minute',
            'AUTH_REFRESH_THROTTLE_RATE': '60/minute',
        }
        with patch.dict(os.environ, custom_values, clear=True):
            self.assertEqual(
                load_auth_throttle_rates(lambda name, default: os.environ.get(name, default)),
                {
                    'auth_register': '2/hour',
                    'auth_login': '8/minute',
                    'auth_refresh': '60/minute',
                },
            )

    def test_invalid_auth_throttle_values_fail_during_settings_configuration(self):
        invalid_values = ('', 'not-a-rate', '2/week', '-1/minute', '0/hour', '2/minute/extra')
        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaisesMessage(ImproperlyConfigured, 'AUTH_LOGIN_THROTTLE_RATE'):
                    load_auth_throttle_rates(
                        lambda name, default: value if name == 'AUTH_LOGIN_THROTTLE_RATE' else default
                    )

    def test_invalid_environment_rate_fails_while_importing_django_settings(self):
        environment = os.environ.copy()
        for setting_name in (
            'AUTH_REGISTER_THROTTLE_RATE',
            'AUTH_LOGIN_THROTTLE_RATE',
            'AUTH_REFRESH_THROTTLE_RATE',
        ):
            environment.pop(setting_name, None)
        environment.update({
            'SECRET_KEY': 'local-startup-test-secret-key',
            'DATABASE_URL': 'postgresql://unused:unused@127.0.0.1/unused',
            'AUTH_LOGIN_THROTTLE_RATE': '1/week',
        })
        backend_directory = os.path.dirname(os.path.dirname(__file__))
        result = subprocess.run(
            [sys.executable, '-c', 'import config.settings'],
            cwd=backend_directory,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ImproperlyConfigured', result.stderr)
        self.assertIn('AUTH_LOGIN_THROTTLE_RATE', result.stderr)

    def test_validator_accepts_supported_period_forms(self):
        for rate in ('5/second', '5/minute', '5/hour', '5/day', '5/m', '5/h'):
            with self.subTest(rate=rate):
                self.assertEqual(validate_auth_throttle_rate('AUTH_LOGIN_THROTTLE_RATE', rate), rate)

    @patch.dict(ScopedRateThrottle.THROTTLE_RATES, {
        'auth_register': '1/minute',
        'auth_login': '1/minute',
        'auth_refresh': '1/minute',
    })
    def test_auth_scopes_throttle_independently_without_limiting_regular_api(self):
        client = APIClient()
        login_payload = {'email': 'missing@example.com', 'password': 'wrong'}
        self.assertEqual(client.post(reverse('auth-login'), login_payload, format='json').status_code, 401)
        self.assertEqual(client.post(reverse('auth-login'), login_payload, format='json').status_code, 429)

        register_payload = {
            'email': 'throttle@example.com',
            'password': 'Strong-pass-123',
            'full_name': 'Throttle Test',
        }
        self.assertEqual(client.post(reverse('auth-register'), register_payload, format='json').status_code, 201)
        self.assertEqual(client.post(reverse('auth-register'), {
            **register_payload, 'email': 'throttle2@example.com',
        }, format='json').status_code, 429)

        user = User.objects.create_user(
            email='refresh@example.com', password='Strong-pass-123', full_name='Refresh Test'
        )
        refresh = RefreshToken.for_user(user)
        refresh_payload = {'refresh': str(refresh)}
        self.assertEqual(client.post(reverse('auth-refresh'), refresh_payload, format='json').status_code, 200)
        self.assertEqual(client.post(reverse('auth-refresh'), refresh_payload, format='json').status_code, 429)

        UserModuleAccess.objects.create(user=user, module=AppModule.objects.get(code='tradedesk'))
        regular_client = APIClient()
        regular_client.force_authenticate(user)
        self.assertEqual(regular_client.get(reverse('portfolio-list')).status_code, 200)


class ModuleAccessAdminTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            email='admin@example.com', password='Strong-pass-123', full_name='Admin'
        )
        self.user = User.objects.create_user(
            email='user@example.com', password='Strong-pass-123', full_name='User'
        )
        self.module, _ = AppModule.objects.get_or_create(
            code='wealth', defaults={'name': 'WealthOnCruise'}
        )
        self.client.force_login(self.admin)

    def test_admin_can_grant_and_revoke_with_actor_audit(self):
        add_url = reverse('admin:users_usermoduleaccess_add')
        added = self.client.post(add_url, {'user': self.user.pk, 'module': self.module.pk}, follow=True)
        self.assertEqual(added.status_code, 200)
        grant = UserModuleAccess.objects.get(user=self.user, module=self.module)
        self.assertEqual(grant.granted_by, self.admin)
        self.assertEqual(grant.grantor_id_snapshot, self.admin.pk)
        self.assertEqual(grant.grantor_email_snapshot, self.admin.email)

        changelist = reverse('admin:users_usermoduleaccess_changelist')
        revoked = self.client.post(changelist, {
            'action': 'revoke_selected_grants',
            '_selected_action': [grant.pk],
            'index': 0,
        }, follow=True)
        self.assertEqual(revoked.status_code, 200)
        grant.refresh_from_db()
        self.assertIsNotNone(grant.revoked_at)
        self.assertEqual(grant.revoked_by, self.admin)
        self.assertEqual(grant.revoker_id_snapshot, self.admin.pk)
        self.assertEqual(grant.revoker_email_snapshot, self.admin.email)
