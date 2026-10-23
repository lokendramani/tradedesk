from .models import UserModuleAccess


def get_active_module_codes(user):
    if not user or not user.is_authenticated:
        return []

    return list(
        UserModuleAccess.objects.filter(
            user_id=user.pk,
            module__is_active=True,
            revoked_at__isnull=True,
        )
        .order_by('module__code')
        .values_list('module__code', flat=True)
    )
