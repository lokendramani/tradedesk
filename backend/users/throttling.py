import re

from django.core.exceptions import ImproperlyConfigured


_RATE_PATTERN = re.compile(
    r'^(?P<count>\d+)/(?P<period>second|seconds|minute|minutes|hour|hours|day|days|s|m|h|d)$'
)

_AUTH_THROTTLE_SETTINGS = (
    ('auth_register', 'AUTH_REGISTER_THROTTLE_RATE', '5/hour'),
    ('auth_login', 'AUTH_LOGIN_THROTTLE_RATE', '5/minute'),
    ('auth_refresh', 'AUTH_REFRESH_THROTTLE_RATE', '60/minute'),
)


def validate_auth_throttle_rate(setting_name, rate):
    """Return a valid positive DRF rate or fail during settings initialization."""
    match = _RATE_PATTERN.fullmatch(rate) if isinstance(rate, str) else None
    if match is None or int(match.group('count')) <= 0:
        raise ImproperlyConfigured(
            f"Invalid {setting_name} value {rate!r}; expected a positive DRF rate "
            "such as '5/minute', '5/hour', or '60/minute'."
        )
    return rate


def load_auth_throttle_rates(config):
    """Read and validate the three public-auth throttle settings."""
    return {
        scope: validate_auth_throttle_rate(
            setting_name,
            config(setting_name, default=default),
        )
        for scope, setting_name, default in _AUTH_THROTTLE_SETTINGS
    }


def set_auth_throttle_scope(scope):
    """Attach a DRF ScopedRateThrottle scope to an api_view wrapper."""
    def decorator(view):
        view.cls.throttle_scope = scope
        return view
    return decorator
