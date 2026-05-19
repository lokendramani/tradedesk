from django.db import models
from portfolio.models import Portfolio
import uuid
from decimal import Decimal, ROUND_HALF_UP

class Trade(models.Model):
    class Segment(models.TextChoices):
        EQUITY    = 'EQUITY',    'Equity'
        COMMODITY = 'COMMODITY', 'Commodity'
        FNO       = 'F_AND_O',   'F&O'

    class Direction(models.TextChoices):
        LONG  = 'LONG',  'Long'
        SHORT = 'SHORT', 'Short'

    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    portfolio    = models.ForeignKey(Portfolio, on_delete=models.CASCADE, related_name='trades')

    # Entry Details
    scrip_name   = models.CharField(max_length=255)
    segment      = models.CharField(max_length=20, choices=Segment.choices)
    direction    = models.CharField(max_length=10, choices=Direction.choices, default=Direction.LONG)
    legs         = models.IntegerField(null=True, blank=True)
    entry_date   = models.DateField()
    entry_price  = models.DecimalField(max_digits=15, decimal_places=4)
    quantity     = models.DecimalField(max_digits=15, decimal_places=4)
    stop_loss    = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    target       = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    initial_risk = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)

    # Close Details
    close_date   = models.DateField(null=True, blank=True)
    close_price  = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)

    # Calculated Fields
    gross_pl     = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    charges      = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    net_income   = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    risk_reward  = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)

    notes        = models.TextField(blank=True, default='')
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'trades'
        ordering = ['-entry_date', '-created_at']
        indexes  = [
            models.Index(fields=['portfolio', 'entry_date']),
            models.Index(fields=['portfolio', 'close_date']),
            models.Index(fields=['portfolio', 'segment']),
        ]

    def __str__(self):
        return f"{self.scrip_name} ({self.segment}) - {self.entry_date}"

    @property
    def is_closed(self):
        return self.close_date is not None or self.close_price is not None

    def calculate_target(self):
        if not self.entry_price or not self.stop_loss:
            return None
        dist = abs(self.entry_price - self.stop_loss)
        move = dist * 2
        if self.direction == self.Direction.LONG:
            return (self.entry_price + move).quantize(Decimal('0.01'), ROUND_HALF_UP)
        return (self.entry_price - move).quantize(Decimal('0.01'), ROUND_HALF_UP)

    def calculate_initial_risk(self):
        if not self.entry_price or not self.stop_loss or not self.quantity:
            return None
        return (abs(self.entry_price - self.stop_loss) * self.quantity).quantize(Decimal('0.01'), ROUND_HALF_UP)

    def calculate_gross_pl(self):
        if not self.entry_price or not self.close_price or not self.quantity:
            return None
        if self.direction == self.Direction.LONG:
            diff = self.close_price - self.entry_price
        else:
            diff = self.entry_price - self.close_price
        return (diff * self.quantity).quantize(Decimal('0.01'), ROUND_HALF_UP)

    def calculate_charges(self):
        if not self.entry_price or not self.close_price:
            return Decimal('0')
        e, c, q = self.entry_price, self.close_price, self.quantity or Decimal('0')
        if self.segment == self.Segment.EQUITY:
            return (Decimal('0.0011') * (e + c) * q).quantize(Decimal('0.01'), ROUND_HALF_UP)
        elif self.segment == self.Segment.COMMODITY:
            return (Decimal('0.0002') * (e + c) * q).quantize(Decimal('0.01'), ROUND_HALF_UP)
        elif self.segment == self.Segment.FNO:
            legs = self.legs or 0
            return (Decimal('130') * legs).quantize(Decimal('0.01'), ROUND_HALF_UP)
        return Decimal('0')

    def recalculate(self):
        self.target       = self.calculate_target()
        self.initial_risk = self.calculate_initial_risk()
        if self.is_closed:
            self.gross_pl = self.calculate_gross_pl()
            self.charges  = self.calculate_charges()
            if self.gross_pl is not None:
                ch = self.charges or Decimal('0')
                self.net_income = (self.gross_pl - ch).quantize(Decimal('0.01'), ROUND_HALF_UP)
            if self.net_income and self.initial_risk and self.initial_risk != 0:
                self.risk_reward = (self.net_income / self.initial_risk).quantize(Decimal('0.0001'), ROUND_HALF_UP)

    def save(self, *args, **kwargs):
        self.recalculate()
        super().save(*args, **kwargs)