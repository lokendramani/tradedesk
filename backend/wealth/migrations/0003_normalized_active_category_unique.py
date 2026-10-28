from django.db import migrations, models
from django.db.models import F, Q
from django.db.models.functions import Lower, Trim


class Migration(migrations.Migration):

    dependencies = [
        ('wealth', '0002_cashflowentry_positive_wealth_cash_flow_amount'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='cashflowcategory',
            name='unique_wealth_cash_flow_category',
        ),
        migrations.AddConstraint(
            model_name='cashflowcategory',
            constraint=models.UniqueConstraint(
                F('user'),
                F('section'),
                Lower(Trim('name')),
                condition=Q(is_archived=False),
                name='uniq_active_wealth_cashflow_category',
            ),
        ),
    ]
