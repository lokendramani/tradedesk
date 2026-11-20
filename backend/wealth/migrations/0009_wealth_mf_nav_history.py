import decimal
import uuid

import django.core.validators
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('wealth', '0008_wealth_mf_detail_four_decimal_precision'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='WealthMFNAVHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nav_date', models.DateField()),
                ('nav', models.DecimalField(decimal_places=4, max_digits=18, validators=[django.core.validators.MinValueValidator(decimal.Decimal('0.0001'))])),
                ('source', models.CharField(choices=[('MFAPI', 'MFAPI'), ('AMFI', 'AMFI')], max_length=8)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('scheme', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='nav_history', to='wealth.mutualfundscheme')),
            ],
            options={
                'db_table': 'wealth_mf_nav_history',
                'ordering': ['nav_date'],
            },
        ),
        migrations.AddConstraint(
            model_name='wealthmfnavhistory',
            constraint=models.UniqueConstraint(fields=('scheme', 'nav_date'), name='uniq_wealth_mf_nav_date'),
        ),
        migrations.AddConstraint(
            model_name='wealthmfnavhistory',
            constraint=models.CheckConstraint(check=models.Q(('nav__gt', 0)), name='wealth_mf_nav_positive'),
        ),
        migrations.AddIndex(
            model_name='wealthmfnavhistory',
            index=models.Index(fields=['scheme', '-nav_date'], name='wealth_mf_nav_latest_idx'),
        ),
        migrations.CreateModel(
            name='WealthMFNAVHistoryLoad',
            fields=[
                ('scheme', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name='nav_history_load', serialize=False, to='wealth.mutualfundscheme')),
                ('history_loaded_at', models.DateTimeField(blank=True, null=True)),
                ('last_attempt_at', models.DateTimeField(blank=True, null=True)),
                ('error_summary', models.CharField(blank=True, max_length=300)),
            ],
            options={
                'db_table': 'wealth_mf_nav_history_loads',
            },
        ),
        migrations.CreateModel(
            name='WealthMFNAVUpdateRun',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('trigger_type', models.CharField(default='ADMIN_MANUAL', max_length=20)),
                ('status', models.CharField(choices=[('RUNNING', 'Running'), ('SUCCESS', 'Success'), ('PARTIAL', 'Partial'), ('FAILED', 'Failed')], default='RUNNING', max_length=10)),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('held_scheme_count', models.PositiveIntegerField(default=0)),
                ('inserted_count', models.PositiveIntegerField(default=0)),
                ('updated_count', models.PositiveIntegerField(default=0)),
                ('skipped_count', models.PositiveIntegerField(default=0)),
                ('failed_count', models.PositiveIntegerField(default=0)),
                ('error_summary', models.CharField(blank=True, max_length=500)),
                ('triggered_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='wealth_mf_nav_update_runs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'wealth_mf_nav_update_runs',
                'ordering': ['-started_at', '-id'],
            },
        ),
        migrations.CreateModel(
            name='WealthMFNAVUpdateLock',
            fields=[
                ('id', models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('active_run', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='active_lock_rows', to='wealth.wealthmfnavupdaterun')),
            ],
            options={
                'db_table': 'wealth_mf_nav_update_lock',
            },
        ),
    ]
