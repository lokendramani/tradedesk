import uuid

from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('wealth', '0009_wealth_mf_nav_history'),
    ]

    operations = [
        migrations.AddField(
            model_name='wealthmftransactiondetail',
            name='charges_source',
            field=models.CharField(
                choices=[('AUTOMATIC', 'Automatic'), ('MANUAL', 'Manual'), ('MIXED', 'Mixed')],
                default='MANUAL',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='wealthmftransactiondetail',
            name='charges_breakdown',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.CreateModel(
            name='WealthSIPMandate',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('monthly_amount', models.DecimalField(decimal_places=2, max_digits=18)),
                ('sip_day', models.PositiveSmallIntegerField(validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(28)])),
                ('start_date', models.DateField()),
                ('generate_from_date', models.DateField()),
                ('end_date', models.DateField(blank=True, null=True)),
                ('generated_through', models.DateField(blank=True, null=True)),
                ('status', models.CharField(choices=[('ACTIVE', 'Active'), ('PAUSED', 'Paused'), ('COMPLETED', 'Completed')], default='ACTIVE', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('folio', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='sip_mandates', to='wealth.wealthfolio')),
                ('scheme', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='wealth_sip_mandates', to='wealth.mutualfundscheme')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='wealth_sip_mandates', to=settings.AUTH_USER_MODEL)),
            ],
            options={'db_table': 'wealth_sip_mandates', 'ordering': ['-created_at', '-id']},
        ),
        migrations.CreateModel(
            name='WealthSIPInstallment',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('scheduled_date', models.DateField()),
                ('amount', models.DecimalField(decimal_places=2, max_digits=18)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('CONFIRMED', 'Confirmed')], default='PENDING', max_length=10)),
                ('transaction_id_snapshot', models.UUIDField(blank=True, db_index=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('mandate', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='installments', to='wealth.wealthsipmandate')),
                ('transaction', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='sip_installment', to='wealth.wealthtransaction')),
            ],
            options={'db_table': 'wealth_sip_installments', 'ordering': ['scheduled_date', 'id']},
        ),
        migrations.AddConstraint(
            model_name='wealthsipinstallment',
            constraint=models.UniqueConstraint(fields=('mandate', 'scheduled_date'), name='uniq_wealth_sip_installment_date'),
        ),
    ]
