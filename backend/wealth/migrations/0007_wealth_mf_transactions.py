import uuid
from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('wealth', '0006_wealth_fund_house_normalization'),
    ]

    operations = [
        migrations.CreateModel(
            name='WealthFolio',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('folio_number', models.CharField(max_length=80)),
                ('name', models.CharField(blank=True, max_length=120)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('fund_house', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='folios', to='wealth.wealthfundhouse')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='wealth_folios', to=settings.AUTH_USER_MODEL)),
            ],
            options={'db_table': 'wealth_folios', 'ordering': ['folio_number', 'id']},
        ),
        migrations.CreateModel(
            name='WealthInstrument',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('instrument_type', models.CharField(choices=[('MUTUAL_FUND', 'Mutual fund'), ('OTHER', 'Other')], default='MUTUAL_FUND', max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('scheme', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='wealth_instrument', to='wealth.mutualfundscheme')),
            ],
            options={'db_table': 'wealth_instruments', 'ordering': ['instrument_type', 'id']},
        ),
        migrations.CreateModel(
            name='WealthTransaction',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('transaction_type', models.CharField(choices=[('PURCHASE', 'Purchase'), ('REDEMPTION', 'Redemption'), ('SWITCH_OUT', 'Switch out'), ('SWITCH_IN', 'Switch in'), ('DIVIDEND', 'Dividend'), ('BONUS', 'Bonus'), ('OTHER', 'Other')], max_length=12)),
                ('transaction_date', models.DateField()),
                ('source', models.CharField(choices=[('MANUAL', 'Manual'), ('SIP', 'SIP'), ('IMPORT', 'Import'), ('OTHER', 'Other')], default='MANUAL', max_length=10)),
                ('source_reference', models.CharField(blank=True, max_length=120)),
                ('switch_group_id', models.UUIDField(blank=True, db_index=True, null=True)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('folio', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='transactions', to='wealth.wealthfolio')),
                ('instrument', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='transactions', to='wealth.wealthinstrument')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='wealth_transactions', to=settings.AUTH_USER_MODEL)),
            ],
            options={'db_table': 'wealth_transactions', 'ordering': ['-transaction_date', '-created_at', '-id']},
        ),
        migrations.CreateModel(
            name='WealthTransactionAudit',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('transaction_id_snapshot', models.UUIDField(db_index=True)),
                ('action', models.CharField(choices=[('CREATED', 'Created'), ('UPDATED', 'Updated'), ('DELETED', 'Deleted')], max_length=10)),
                ('before', models.JSONField(blank=True, default=dict)),
                ('after', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='wealth_transaction_audit_actions', to=settings.AUTH_USER_MODEL)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='wealth_transaction_audits', to=settings.AUTH_USER_MODEL)),
                ('transaction', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='audit_history', to='wealth.wealthtransaction')),
            ],
            options={'db_table': 'wealth_transaction_audits', 'ordering': ['-created_at', '-id']},
        ),
        migrations.CreateModel(
            name='WealthMFTransactionDetail',
            fields=[
                ('units', models.DecimalField(decimal_places=6, default=Decimal('0'), max_digits=22)),
                ('nav', models.DecimalField(decimal_places=6, default=Decimal('0'), max_digits=18)),
                ('amount', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('charges', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('cashflow', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('transaction', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name='mf_detail', serialize=False, to='wealth.wealthtransaction')),
            ],
            options={'db_table': 'wealth_mf_transaction_details'},
        ),
        migrations.AddConstraint(
            model_name='wealthfolio',
            constraint=models.UniqueConstraint(fields=('user', 'folio_number'), name='uniq_wealth_user_folio'),
        ),
        migrations.AddConstraint(
            model_name='wealthtransaction',
            constraint=models.CheckConstraint(
                check=(models.Q(('switch_group_id__isnull', False), ('transaction_type__in', ['SWITCH_OUT', 'SWITCH_IN']))
                       | (~models.Q(('transaction_type__in', ['SWITCH_OUT', 'SWITCH_IN'])) & models.Q(('switch_group_id__isnull', True)))),
                name='wealth_switch_type_group_consistent',
            ),
        ),
        migrations.AddConstraint(
            model_name='wealthtransaction',
            constraint=models.CheckConstraint(
                check=(~models.Q(('source', 'SIP')) | models.Q(('transaction_type', 'PURCHASE'))),
                name='wealth_sip_source_purchase_only',
            ),
        ),
        migrations.AddIndex(
            model_name='wealthtransaction',
            index=models.Index(fields=['user', 'transaction_date'], name='wealth_tx_user_date_idx'),
        ),
        migrations.AddIndex(
            model_name='wealthtransaction',
            index=models.Index(fields=['instrument', 'transaction_date'], name='wealth_tx_inst_date_idx'),
        ),
    ]
