from rest_framework.permissions import BasePermission

from .models import UserModuleAccess


class HasModuleAccess(BasePermission):
    """Require an active module grant, checked against the database per request."""

    module_code = None

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated or not self.module_code:
            return False

        return UserModuleAccess.objects.filter(
            user_id=user.pk,
            module__code=self.module_code,
            module__is_active=True,
            revoked_at__isnull=True,
        ).exists()


class HasTradeDeskAccess(HasModuleAccess):
    module_code = 'tradedesk'


class HasWealthAccess(HasModuleAccess):
    module_code = 'wealth'
