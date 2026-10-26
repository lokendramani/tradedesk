"""Local-only settings for tests; the test runner never connects to Supabase."""

import os

os.environ['SECRET_KEY'] = 'local-tests-only-secret-key-32-bytes-minimum'
os.environ['DATABASE_URL'] = 'postgresql://unused:unused@127.0.0.1/unused'
os.environ['AUTH_REGISTER_THROTTLE_RATE'] = '5/hour'
os.environ['AUTH_LOGIN_THROTTLE_RATE'] = '5/minute'
os.environ['AUTH_REFRESH_THROTTLE_RATE'] = '60/minute'

from .settings import *  # noqa: F401,F403,E402

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
