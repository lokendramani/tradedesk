from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sip', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='SIPETFMaster',
            fields=[
                ('ticker',      models.CharField(max_length=20, primary_key=True, serialize=False)),
                ('etf_name',    models.CharField(max_length=150)),
                ('asset_class', models.CharField(max_length=30)),
                ('is_active',   models.BooleanField(default=True)),
                ('created_at',  models.DateTimeField(auto_now_add=True)),
                ('updated_at',  models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['etf_name'],
            },
        ),
    ]
