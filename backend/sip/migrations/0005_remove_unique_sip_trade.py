from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('sip', '0004_fix_etfmaster_asset_class'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='siptrade',
            name='unique_sip_trade',
        ),
    ]
