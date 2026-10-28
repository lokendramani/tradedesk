from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce, Lower, Trim


class CashFlowProfile(models.Model):
    """One current recurring monthly profile per user."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='wealth_cash_flow_profile',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'wealth_cash_flow_profiles'

    def calculate_totals(self):
        amount_field = DecimalField(max_digits=14, decimal_places=2)
        zero = Value(Decimal('0.00'), output_field=amount_field)
        totals = self.entries.aggregate(
            income=Coalesce(Sum('amount', filter=Q(category__section=CashFlowCategory.Section.INCOME)), zero, output_field=amount_field),
            savings=Coalesce(Sum('amount', filter=Q(category__section=CashFlowCategory.Section.SAVINGS)), zero, output_field=amount_field),
            expenses=Coalesce(Sum('amount', filter=Q(category__section=CashFlowCategory.Section.EXPENSES)), zero, output_field=amount_field),
        )
        income = totals['income'].quantize(Decimal('0.01'))
        savings = totals['savings'].quantize(Decimal('0.01'))
        expenses = totals['expenses'].quantize(Decimal('0.01'))
        surplus = (income - savings - expenses).quantize(Decimal('0.01'))
        savings_rate = (
            (savings / income * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            if income else Decimal('0.00')
        )
        return {
            'income': income,
            'savings': savings,
            'expenses': expenses,
            'surplus': surplus,
            'savings_rate': savings_rate,
        }


class CashFlowCategory(models.Model):
    class Section(models.TextChoices):
        INCOME = 'INCOME', 'Income'
        SAVINGS = 'SAVINGS', 'Savings'
        EXPENSES = 'EXPENSES', 'Expenses'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='wealth_cash_flow_categories',
    )
    section = models.CharField(max_length=12, choices=Section.choices)
    name = models.CharField(max_length=80)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_cash_flow_categories'
        ordering = ['section', 'name', 'id']
        constraints = [
            models.UniqueConstraint(
                F('user'),
                F('section'),
                Lower(Trim('name')),
                condition=Q(is_archived=False),
                name='uniq_active_wealth_cashflow_category',
            )
        ]

    def __str__(self):
        return f'{self.get_section_display()}: {self.name}'


class CashFlowEntry(models.Model):
    profile = models.ForeignKey(
        CashFlowProfile,
        on_delete=models.CASCADE,
        related_name='entries',
    )
    category = models.ForeignKey(
        CashFlowCategory,
        on_delete=models.PROTECT,
        related_name='entries',
    )
    name = models.CharField(max_length=120)
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_cash_flow_entries'
        ordering = ['category__section', 'category__name', 'name', 'id']
        constraints = [
            models.CheckConstraint(check=Q(amount__gt=0), name='positive_wealth_cash_flow_amount'),
        ]

    def __str__(self):
        return f'{self.name}: {self.amount}'
