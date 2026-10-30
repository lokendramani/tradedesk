# Generated for the shared AMFI scheme catalogue.
from django.db import migrations, models


def create_catalogue_lock(apps, schema_editor):
    Lock = apps.get_model('wealth', 'SchemeCatalogueRunLock')
    Lock.objects.using(schema_editor.connection.alias).get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [
        ('wealth', '0004_wealthmilestone'),
    ]

    operations = [
        migrations.CreateModel(
            name='MutualFundScheme',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scheme_code', models.CharField(max_length=32, unique=True)),
                ('scheme_name', models.CharField(max_length=300)),
                ('fund_house', models.CharField(blank=True, max_length=180)),
                ('category_name', models.CharField(blank=True, max_length=180)),
                ('asset_class', models.CharField(choices=[('EQUITY', 'Equity'), ('DEBT', 'Debt'), ('HYBRID', 'Hybrid'), ('OTHER', 'Other'), ('UNKNOWN', 'Unknown')], default='UNKNOWN', max_length=10)),
                ('plan_type', models.CharField(choices=[('DIRECT', 'Direct'), ('REGULAR', 'Regular'), ('UNKNOWN', 'Unknown')], default='UNKNOWN', max_length=10)),
                ('option_type', models.CharField(choices=[('GROWTH', 'Growth'), ('IDCW', 'IDCW'), ('OTHER', 'Other'), ('UNKNOWN', 'Unknown')], default='UNKNOWN', max_length=10)),
                ('isin_growth', models.CharField(blank=True, max_length=20, null=True)),
                ('isin_div_payout', models.CharField(blank=True, max_length=20, null=True)),
                ('isin_div_reinvestment', models.CharField(blank=True, max_length=20, null=True)),
                ('last_seen_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'wealth_mutual_fund_schemes', 'ordering': ['scheme_name', 'scheme_code']},
        ),
        migrations.CreateModel(
            name='SchemeCatalogueImportLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('operation', models.CharField(choices=[('INITIAL', 'Initial'), ('REFRESH', 'Refresh')], max_length=10)),
                ('status', models.CharField(choices=[('RUNNING', 'Running'), ('SUCCESS', 'Success'), ('SKIPPED', 'Skipped'), ('FAILED', 'Failed')], max_length=10)),
                ('source', models.URLField(max_length=300)),
                ('parsed_count', models.PositiveIntegerField(default=0)),
                ('valid_count', models.PositiveIntegerField(default=0)),
                ('inserted_count', models.PositiveIntegerField(default=0)),
                ('updated_count', models.PositiveIntegerField(default=0)),
                ('unchanged_count', models.PositiveIntegerField(default=0)),
                ('rejected_count', models.PositiveIntegerField(default=0)),
                ('error_summary', models.CharField(blank=True, max_length=500)),
            ],
            options={'db_table': 'wealth_scheme_catalogue_import_logs', 'ordering': ['-started_at', '-id']},
        ),
        migrations.CreateModel(
            name='SchemeCatalogueRunLock',
            fields=[('id', models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False))],
            options={'db_table': 'wealth_scheme_catalogue_run_lock'},
        ),
        migrations.AddIndex(
            model_name='mutualfundscheme',
            index=models.Index(fields=['fund_house'], name='wealth_scheme_fund_house_idx'),
        ),
        migrations.AddIndex(
            model_name='mutualfundscheme',
            index=models.Index(fields=['asset_class', 'plan_type', 'option_type'], name='wealth_scheme_filters_idx'),
        ),
        migrations.RunPython(create_catalogue_lock, migrations.RunPython.noop),
    ]
