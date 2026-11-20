from django.db import migrations, models
import django.db.models.deletion
import uuid


def map_exact_fund_house_values(apps, schema_editor):
    Scheme = apps.get_model('wealth', 'MutualFundScheme')
    FundHouse = apps.get_model('wealth', 'WealthFundHouse')
    database = schema_editor.connection.alias

    # Preserve every nonblank legacy spelling as its own reviewable master.
    # This intentionally does not infer aliases or merge differently named AMCs.
    names = (
        Scheme.objects.using(database)
        .order_by()
        .values_list('fund_house', flat=True)
        .distinct()
    )
    for name in names.iterator():
        if not name or not name.strip():
            continue
        fund_house, _ = FundHouse.objects.using(database).get_or_create(name=name)
        Scheme.objects.using(database).filter(fund_house=name).update(
            fund_house_master_id=fund_house.pk,
        )


class Migration(migrations.Migration):
    dependencies = [
        ('wealth', '0005_mutual_fund_scheme_catalogue'),
    ]

    operations = [
        migrations.CreateModel(
            name='WealthFundHouse',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=180, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'wealth_fund_houses',
                'ordering': ['name'],
            },
        ),
        migrations.AddField(
            model_name='mutualfundscheme',
            name='fund_house_master',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='schemes',
                to='wealth.wealthfundhouse',
            ),
        ),
        migrations.RunPython(map_exact_fund_house_values, migrations.RunPython.noop),
    ]
