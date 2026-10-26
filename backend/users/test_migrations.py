import warnings

from django.conf import settings
from django.db import connections
from django.db.migrations.exceptions import IrreversibleError
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase, override_settings


class IsolatedMigrationTestCase(SimpleTestCase):
    """Run migration tests on a private in-memory SQLite connection."""

    databases = '__all__'
    migrate_from = [('users', '0001_initial')]
    migrate_to = [('users', '0002_appmodule_usermoduleaccess')]

    def setUp(self):
        super().setUp()
        self.db_alias = 'module_migration_test'
        databases = dict(settings.DATABASES)
        databases[self.db_alias] = {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': ':memory:',
        }
        self._database_override = override_settings(DATABASES=databases)
        with warnings.catch_warnings():
            warnings.filterwarnings(
                'ignore',
                message='Overriding setting DATABASES can lead to unexpected behavior.',
                category=UserWarning,
            )
            self._database_override.enable()
        self._old_connection_settings = connections._settings
        self._old_cached_connection_settings = connections.__dict__.pop('settings', None)
        connections._settings = databases
        self.connection = connections[self.db_alias]
        executor = MigrationExecutor(self.connection)
        executor.migrate(self.migrate_from)

    def tearDown(self):
        self.connection.close()
        try:
            del connections[self.db_alias]
        except AttributeError:
            pass
        connections._settings = self._old_connection_settings
        connections.__dict__.pop('settings', None)
        if self._old_cached_connection_settings is not None:
            connections.settings = self._old_cached_connection_settings
        self._database_override.disable()
        super().tearDown()


class ModuleAccessMigrationTests(IsolatedMigrationTestCase):
    def setUp(self):
        super().setUp()
        old_apps = MigrationExecutor(self.connection).loader.project_state(self.migrate_from).apps
        User = old_apps.get_model('users', 'User')
        User.objects.using(self.db_alias).create(
            email='existing@example.com',
            full_name='Existing User',
            password='not-used-by-this-migration-test',
        )
        User.objects.using(self.db_alias).create(
            email='admin-existing@example.com',
            full_name='Existing Admin',
            password='not-used-by-this-migration-test',
            role='ADMIN',
            is_staff=True,
            is_superuser=True,
        )

        MigrationExecutor(self.connection).migrate(self.migrate_to)
        self.apps = MigrationExecutor(self.connection).loader.project_state(self.migrate_to).apps

    def test_existing_accounts_get_only_tradedesk_and_no_invented_grantor(self):
        User = self.apps.get_model('users', 'User')
        AppModule = self.apps.get_model('users', 'AppModule')
        UserModuleAccess = self.apps.get_model('users', 'UserModuleAccess')

        self.assertEqual(AppModule.objects.using(self.db_alias).count(), 2)
        self.assertTrue(AppModule.objects.using(self.db_alias).filter(
            code='tradedesk', is_active=True
        ).exists())
        self.assertTrue(AppModule.objects.using(self.db_alias).filter(
            code='wealth', is_active=True
        ).exists())
        self.assertEqual(
            UserModuleAccess.objects.using(self.db_alias).count(),
            User.objects.using(self.db_alias).count(),
        )
        self.assertFalse(UserModuleAccess.objects.using(self.db_alias).filter(
            module__code='wealth'
        ).exists())
        self.assertFalse(UserModuleAccess.objects.using(self.db_alias).filter(
            granted_by__isnull=False
        ).exists())
        self.assertFalse(UserModuleAccess.objects.using(self.db_alias).filter(
            revoked_by__isnull=False
        ).exists())
        self.assertFalse(UserModuleAccess.objects.using(self.db_alias).filter(
            grantor_email_snapshot__isnull=False
        ).exists())
        self.assertFalse(UserModuleAccess.objects.using(self.db_alias).filter(
            revoker_email_snapshot__isnull=False
        ).exists())
        self.assertEqual(
            set(UserModuleAccess.objects.using(self.db_alias).values_list(
                'subject_email_snapshot', flat=True
            )),
            {'existing@example.com', 'admin-existing@example.com'},
        )

    def test_reverse_migration_is_blocked_before_schema_or_grants_are_removed(self):
        executor = MigrationExecutor(self.connection)
        with self.assertRaises(IrreversibleError):
            executor.migrate(self.migrate_from)

        UserModuleAccess = self.apps.get_model('users', 'UserModuleAccess')
        self.assertEqual(UserModuleAccess.objects.using(self.db_alias).count(), 2)
        self.assertTrue(UserModuleAccess.objects.using(self.db_alias).filter(
            module__code='tradedesk'
        ).exists())


class EmptyUserTableModuleAccessMigrationTests(IsolatedMigrationTestCase):
    def test_empty_user_table_seeds_modules_without_grants(self):
        old_apps = MigrationExecutor(self.connection).loader.project_state(self.migrate_from).apps
        User = old_apps.get_model('users', 'User')
        self.assertEqual(User.objects.using(self.db_alias).count(), 0)

        MigrationExecutor(self.connection).migrate(self.migrate_to)
        apps = MigrationExecutor(self.connection).loader.project_state(self.migrate_to).apps
        AppModule = apps.get_model('users', 'AppModule')
        UserModuleAccess = apps.get_model('users', 'UserModuleAccess')
        self.assertEqual(
            set(AppModule.objects.using(self.db_alias).values_list('code', flat=True)),
            {'tradedesk', 'wealth'},
        )
        self.assertEqual(UserModuleAccess.objects.using(self.db_alias).count(), 0)
