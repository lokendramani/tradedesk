from django.db import migrations


def fix_asset_classes(apps, schema_editor):
    SIPETFMaster = apps.get_model('sip', 'SIPETFMaster')
    SIPETFMaster.objects.filter(ticker__in=['MON100', 'HNGSNGBEES'], asset_class='International').update(asset_class='Equity')


class Migration(migrations.Migration):

    dependencies = [
        ('sip', '0003_seed_etfmaster'),
    ]

    operations = [
        migrations.RunPython(fix_asset_classes, reverse_code=migrations.RunPython.noop),
    ]
