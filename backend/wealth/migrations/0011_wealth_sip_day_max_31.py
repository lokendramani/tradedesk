from django.db import migrations, models
import django.core.validators


class Migration(migrations.Migration):
    dependencies = [
        ('wealth', '0010_sip_mandates_and_charge_metadata'),
    ]

    operations = [
        migrations.AlterField(
            model_name='wealthsipmandate',
            name='sip_day',
            field=models.PositiveSmallIntegerField(
                validators=[
                    django.core.validators.MinValueValidator(1),
                    django.core.validators.MaxValueValidator(31),
                ],
            ),
        ),
    ]
