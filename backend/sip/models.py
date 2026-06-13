import uuid
from django.conf import settings
from django.db import models


class SIPTrade(models.Model):
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sip_trades')
    trade_date = models.DateField()
    etf_name   = models.CharField(max_length=100)
    asset_class = models.CharField(max_length=20)
    ticker     = models.CharField(max_length=20)
    qty        = models.DecimalField(max_digits=12, decimal_places=4)
    price      = models.DecimalField(max_digits=12, decimal_places=4)
    trade_value = models.DecimalField(max_digits=14, decimal_places=4)
    exit_date  = models.DateField(null=True, blank=True)
    exit_price = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    exit_value = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    notes      = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['trade_date']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'trade_date', 'ticker', 'qty', 'price'],
                name='unique_sip_trade'
            )
        ]

    def save(self, *args, **kwargs):
        self.trade_value = self.qty * self.price
        if self.exit_price is not None and self.qty is not None:
            self.exit_value = self.qty * self.exit_price
        else:
            self.exit_value = None
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.trade_date} {self.ticker} x{self.qty}"


class SIPWeeklySnapshot(models.Model):
    id               = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user             = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sip_snapshots')
    week_date        = models.DateField()
    weekly_buy       = models.DecimalField(max_digits=14, decimal_places=4)
    exits_recycled   = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    fresh_cash       = models.DecimalField(max_digits=14, decimal_places=4)
    cumulative_fresh = models.DecimalField(max_digits=14, decimal_places=4)
    portfolio_value  = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['week_date']
        constraints = [
            models.UniqueConstraint(fields=['user', 'week_date'], name='unique_sip_snapshot')
        ]

    def __str__(self):
        return f"{self.week_date} fresh={self.fresh_cash}"


class SIPBenchmarkPrice(models.Model):
    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    week_date       = models.DateField(unique=True)
    nifty50_price   = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    nifty500_price  = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    nifty50_cmp     = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    nifty500_cmp    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['week_date']

    def __str__(self):
        return f"Benchmark {self.week_date}"


class SIPPriceCache(models.Model):
    ticker      = models.CharField(max_length=20)
    price_date  = models.DateField()
    close_price = models.DecimalField(max_digits=12, decimal_places=4)
    is_stale    = models.BooleanField(default=False)
    fetched_at  = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['ticker', 'price_date'], name='unique_sip_price_cache')
        ]

    def __str__(self):
        return f"{self.ticker} {self.price_date} {self.close_price}"
