from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from users.permissions import HasWealthAccess
from wealth.views import wealth_nav_update_admin


class WealthNAVUpdateViewLoggingTests(SimpleTestCase):
    @patch.object(HasWealthAccess, 'has_permission', return_value=True)
    @patch('wealth.views.run_amfi_nav_update', side_effect=RuntimeError('private database detail'))
    def test_unexpected_post_exception_is_logged_but_response_stays_generic(
        self, run_update, _wealth_permission,
    ):
        user = SimpleNamespace(is_authenticated=True, role='ADMIN', is_staff=False)
        request = APIRequestFactory().post('/api/wealth/nav-updates/', {}, format='json')
        force_authenticate(request, user=user)

        with self.assertLogs('wealth.views', level='ERROR') as captured:
            response = wealth_nav_update_admin(request)

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.data,
            {'detail': 'The AMFI NAV update could not be started. Please retry.'},
        )
        self.assertEqual(len(captured.records), 1)
        self.assertIn('trigger=ADMIN_MANUAL', captured.records[0].getMessage())
        self.assertIsNotNone(captured.records[0].exc_info)
        self.assertNotIn('private database detail', str(response.data))
        run_update.assert_called_once_with(triggered_by=user)
