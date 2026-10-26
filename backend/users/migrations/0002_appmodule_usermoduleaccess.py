import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models
from itertools import islice


def create_modules_and_preserve_tradedesk_access(apps, schema_editor):
    AppModule = apps.get_model('users', 'AppModule')
    User = apps.get_model('users', 'User')
    UserModuleAccess = apps.get_model('users', 'UserModuleAccess')
    db_alias = schema_editor.connection.alias

    tradedesk, _ = AppModule.objects.using(db_alias).get_or_create(
        code='tradedesk', defaults={'name': 'TradeDesk', 'is_active': True}
    )
    AppModule.objects.using(db_alias).get_or_create(
        code='wealth', defaults={'name': 'WealthOnCruise', 'is_active': True}
    )

    already_granted = UserModuleAccess.objects.using(db_alias).filter(
        module_id=tradedesk.pk,
        revoked_at__isnull=True,
    ).values_list('user_id', flat=True)
    now = django.utils.timezone.now()
    users = User.objects.using(db_alias).exclude(pk__in=already_granted).values_list(
        'pk', 'email', 'full_name'
    ).iterator(chunk_size=500)
    while batch := list(islice(users, 500)):
        grants = [
            UserModuleAccess(
                user_id=user_id,
                subject_user_id_snapshot=user_id,
                subject_email_snapshot=email,
                subject_name_snapshot=full_name,
                module_id=tradedesk.pk,
                granted_at=now,
            )
            for user_id, email, full_name in batch
        ]
        UserModuleAccess.objects.using(db_alias).bulk_create(grants, batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='AppModule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.SlugField(max_length=50, unique=True)),
                ('name', models.CharField(max_length=100)),
                ('is_active', models.BooleanField(default=True)),
            ],
            options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='UserModuleAccess',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('granted_at', models.DateTimeField(auto_now_add=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('subject_user_id_snapshot', models.UUIDField()),
                ('subject_email_snapshot', models.EmailField(max_length=254)),
                ('subject_name_snapshot', models.CharField(max_length=255)),
                ('grantor_id_snapshot', models.UUIDField(blank=True, null=True)),
                ('grantor_email_snapshot', models.EmailField(blank=True, max_length=254, null=True)),
                ('grantor_name_snapshot', models.CharField(blank=True, max_length=255, null=True)),
                ('revoker_id_snapshot', models.UUIDField(blank=True, null=True)),
                ('revoker_email_snapshot', models.EmailField(blank=True, max_length=254, null=True)),
                ('revoker_name_snapshot', models.CharField(blank=True, max_length=255, null=True)),
                ('granted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='module_access_grants_issued', to=settings.AUTH_USER_MODEL)),
                ('module', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='user_grants', to='users.appmodule')),
                ('revoked_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='module_access_grants_revoked', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='module_access_grants', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['user__email', 'module__code', '-granted_at']},
        ),
        migrations.AddConstraint(
            model_name='usermoduleaccess',
            constraint=models.UniqueConstraint(
                condition=models.Q(('revoked_at__isnull', True)),
                fields=('user', 'module'),
                name='unique_active_user_module_access',
            ),
        ),
        migrations.RunPython(
            create_modules_and_preserve_tradedesk_access,
            # Intentionally irreversible: reversing would drop live grant history.
        ),
    ]
