from django.db import models
from django.conf import settings


class MFFolio(models.Model):
    user         = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mf_folios')
    folio_number = models.CharField(max_length=100)
    fund_house   = models.CharField(max_length=255)
    holder_name  = models.CharField(max_length=255, blank=True)
    pan          = models.CharField(max_length=20, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table        = 'mf_folios'
        unique_together = ('user', 'folio_number')
        ordering        = ['fund_house', 'folio_number']

    def __str__(self):
        return f"{self.folio_number} — {self.fund_house}"


class MFScheme(models.Model):
    class Plan(models.TextChoices):
        DIRECT  = 'DIRECT',  'Direct'
        REGULAR = 'REGULAR', 'Regular'

    class Option(models.TextChoices):
        GROWTH   = 'GROWTH',   'Growth'
        IDCW     = 'IDCW',     'IDCW / Dividend'

    folio           = models.ForeignKey(MFFolio, on_delete=models.CASCADE, related_name='schemes')
    scheme_name     = models.CharField(max_length=500)
    scheme_code     = models.CharField(max_length=50, blank=True)
    isin            = models.CharField(max_length=30, blank=True)
    registrar       = models.CharField(max_length=50, blank=True)   # CAMS / KFintech
    plan            = models.CharField(max_length=10, choices=Plan.choices,   default=Plan.DIRECT)
    option          = models.CharField(max_length=10, choices=Option.choices, default=Option.GROWTH)
    closing_units   = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    closing_nav     = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    closing_nav_date = models.DateField(null=True, blank=True)
    cost_value      = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    market_value    = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'mf_schemes'
        ordering = ['scheme_name']

    def __str__(self):
        return self.scheme_name

    @property
    def gain_loss(self):
        if self.market_value is not None and self.cost_value is not None:
            return self.market_value - self.cost_value
        return None

    @property
    def gain_loss_pct(self):
        if self.gain_loss is not None and self.cost_value and self.cost_value != 0:
            return (self.gain_loss / self.cost_value) * 100
        return None


class MFTransaction(models.Model):
    class TxnType(models.TextChoices):
        SIP        = 'SIP',        'SIP'
        PURCHASE   = 'PURCHASE',   'Purchase'
        REDEMPTION = 'REDEMPTION', 'Redemption'
        SWITCH_IN  = 'SWITCH_IN',  'Switch In'
        SWITCH_OUT = 'SWITCH_OUT', 'Switch Out'
        DIVIDEND   = 'DIVIDEND',   'Dividend / IDCW'
        BONUS      = 'BONUS',      'Bonus'
        OTHER      = 'OTHER',      'Other'

    scheme           = models.ForeignKey(MFScheme, on_delete=models.CASCADE, related_name='transactions')
    transaction_date = models.DateField()
    transaction_type = models.CharField(max_length=15, choices=TxnType.choices, default=TxnType.OTHER)
    description      = models.TextField(blank=True)
    amount           = models.DecimalField(max_digits=18, decimal_places=2)   # negative = outflow
    units            = models.DecimalField(max_digits=18, decimal_places=4)   # negative = redemption
    nav              = models.DecimalField(max_digits=15, decimal_places=4)
    unit_balance     = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        db_table        = 'mf_transactions'
        ordering        = ['transaction_date']
        unique_together = ('scheme', 'transaction_date', 'amount', 'units')

    def __str__(self):
        return f"{self.transaction_date} {self.transaction_type} {self.amount}"
