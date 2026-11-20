from decimal import Decimal

from django.db import migrations, models


def reject_values_beyond_four_decimal_places(apps, schema_editor):
    detail_model = apps.get_model('wealth', 'WealthMFTransactionDetail')
    details = detail_model.objects.using(schema_editor.connection.alias).only('units', 'nav')
    for detail in details.iterator():
        if detail.units != detail.units.quantize(Decimal('0.0001')):
            raise RuntimeError(
                'Wealth MF transaction units contain values beyond four decimal places; '
                'migration stopped to prevent precision loss.'
            )
        if detail.nav != detail.nav.quantize(Decimal('0.0001')):
            raise RuntimeError(
                'Wealth MF transaction NAV contains values beyond four decimal places; '
                'migration stopped to prevent precision loss.'
            )


class Migration(migrations.Migration):
    dependencies = [
        ('wealth', '0007_wealth_mf_transactions'),
    ]

    operations = [
        migrations.RunPython(
            reject_values_beyond_four_decimal_places,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name='wealthmftransactiondetail',
            name='units',
            field=models.DecimalField(decimal_places=4, default=Decimal('0'), max_digits=22),
        ),
        migrations.AlterField(
            model_name='wealthmftransactiondetail',
            name='nav',
            field=models.DecimalField(decimal_places=4, default=Decimal('0'), max_digits=18),
        ),
    ]
