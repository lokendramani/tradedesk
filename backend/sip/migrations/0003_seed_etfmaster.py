from django.db import migrations

ETF_SEED = [
    ('CPSEETF',    'CPSE ETF',                        'Equity'),
    ('DEFENCE',    'Mirae Asset Defence ETF',          'Equity'),
    ('GOLDBEES',   'Gold BEES',                        'Debt'),
    ('HNGSNGBEES', 'Nippon Hangseng ETF',              'Equity'),
    ('ITBEES',     'ITBEES',                           'Equity'),
    ('METALIETF',  'ICICI Pru Metal ETF',              'Equity'),
    ('MODEFENCE',  'Motilal Oswal Defence ETF',        'Equity'),
    ('MON100',     'Motilal Oswal Nasdaq ETF',         'Equity'),
    ('MOREALTY',   'Motilal Oswal Realty ETF',         'Equity'),
    ('OILIETF',    'ICICI Pru Oil and Gas ETF',        'Equity'),
    ('PHARMABEES', 'Nippon Pharma ETF',                'Equity'),
    ('PSUBNKBEES', 'Nippon PSU Bank ETF',              'Equity'),
    ('SILVERBEES', 'Silver BEES',                      'Debt'),
    ('TNIDETF',    'TATA Nifty India Digital ETF',     'Equity'),
]


def seed_etf_master(apps, schema_editor):
    SIPETFMaster = apps.get_model('sip', 'SIPETFMaster')
    SIPETFMaster.objects.bulk_create(
        [SIPETFMaster(ticker=t, etf_name=n, asset_class=a) for t, n, a in ETF_SEED],
        ignore_conflicts=True,
    )


def unseed_etf_master(apps, schema_editor):
    SIPETFMaster = apps.get_model('sip', 'SIPETFMaster')
    SIPETFMaster.objects.filter(ticker__in=[t for t, _, _ in ETF_SEED]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('sip', '0002_sipetfmaster'),
    ]

    operations = [
        migrations.RunPython(seed_etf_master, reverse_code=unseed_etf_master),
    ]
