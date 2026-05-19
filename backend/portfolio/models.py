from django.db import models
from django.conf import settings
import uuid

class Portfolio(models.Model):
    class Type(models.TextChoices):
        TRADING = 'TRADING', 'Trading'
        ETF     = 'ETF',     'ETF'

    id                 = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user               = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='portfolios')
    name               = models.CharField(max_length=255)
    type               = models.CharField(max_length=20, choices=Type.choices, default=Type.TRADING)
    starting_capital   = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    worst_case_capital = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    currency           = models.CharField(max_length=10, default='INR')
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'portfolios'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.user.email})"