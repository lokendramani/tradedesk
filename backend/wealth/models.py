from decimal import Decimal, ROUND_HALF_UP, localcontext

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce, Lower, Trim
from django.utils import timezone


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


class WealthMilestone(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='wealth_milestones',
    )
    name = models.CharField(max_length=120)
    present_amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    target_year = models.PositiveSmallIntegerField()
    inflation_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('7.00'),
        validators=[MinValueValidator(Decimal('0.00')), MaxValueValidator(Decimal('100.00'))],
    )
    expected_return_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('12.00'),
        validators=[MinValueValidator(Decimal('0.00')), MaxValueValidator(Decimal('100.00'))],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_milestones'
        ordering = ['target_year', 'name', 'id']

    @staticmethod
    def _round_rupees(value):
        return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    def calculate_projection(self, current_year=None):
        """Return time-sensitive goal projections without persisting derived values."""
        year = current_year if current_year is not None else timezone.localdate().year
        years_remaining = self.target_year - year
        number_of_months = years_remaining * 12

        with localcontext() as context:
            context.prec = 60
            one = Decimal('1')
            inflation_factor = (one + self.inflation_rate / Decimal('100')) ** years_remaining
            future_amount_exact = self.present_amount * inflation_factor
            future_amount = self._round_rupees(future_amount_exact)

            if number_of_months <= 0:
                required_monthly_sip = None
            else:
                monthly_rate = self.expected_return_rate / Decimal('1200')
                if monthly_rate == 0:
                    required_monthly_sip = self._round_rupees(future_amount_exact / number_of_months)
                else:
                    future_value_factor = (
                        ((one + monthly_rate) ** number_of_months - one) / monthly_rate
                    ) * (one + monthly_rate)
                    required_monthly_sip = self._round_rupees(future_amount_exact / future_value_factor)

        return {
            'years_remaining': years_remaining,
            'future_amount': future_amount,
            'required_monthly_sip': required_monthly_sip,
        }

    def __str__(self):
        return f'{self.name} ({self.target_year})'


class MutualFundScheme(models.Model):
    class AssetClass(models.TextChoices):
        EQUITY = 'EQUITY', 'Equity'
        DEBT = 'DEBT', 'Debt'
        HYBRID = 'HYBRID', 'Hybrid'
        OTHER = 'OTHER', 'Other'
        UNKNOWN = 'UNKNOWN', 'Unknown'

    class PlanType(models.TextChoices):
        DIRECT = 'DIRECT', 'Direct'
        REGULAR = 'REGULAR', 'Regular'
        UNKNOWN = 'UNKNOWN', 'Unknown'

    class OptionType(models.TextChoices):
        GROWTH = 'GROWTH', 'Growth'
        IDCW = 'IDCW', 'IDCW'
        OTHER = 'OTHER', 'Other'
        UNKNOWN = 'UNKNOWN', 'Unknown'

    scheme_code = models.CharField(max_length=32, unique=True)
    scheme_name = models.CharField(max_length=300)
    fund_house = models.CharField(max_length=180, blank=True)
    category_name = models.CharField(max_length=180, blank=True)
    asset_class = models.CharField(max_length=10, choices=AssetClass.choices, default=AssetClass.UNKNOWN)
    plan_type = models.CharField(max_length=10, choices=PlanType.choices, default=PlanType.UNKNOWN)
    option_type = models.CharField(max_length=10, choices=OptionType.choices, default=OptionType.UNKNOWN)
    isin_growth = models.CharField(max_length=20, null=True, blank=True)
    isin_div_payout = models.CharField(max_length=20, null=True, blank=True)
    isin_div_reinvestment = models.CharField(max_length=20, null=True, blank=True)
    last_seen_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_mutual_fund_schemes'
        ordering = ['scheme_name', 'scheme_code']
        indexes = [
            models.Index(fields=['fund_house'], name='wealth_scheme_fund_house_idx'),
            models.Index(fields=['asset_class', 'plan_type', 'option_type'], name='wealth_scheme_filters_idx'),
        ]

    def __str__(self):
        return f'{self.scheme_code}: {self.scheme_name}'


class SchemeCatalogueImportLog(models.Model):
    class Operation(models.TextChoices):
        INITIAL = 'INITIAL', 'Initial'
        REFRESH = 'REFRESH', 'Refresh'

    class Status(models.TextChoices):
        RUNNING = 'RUNNING', 'Running'
        SUCCESS = 'SUCCESS', 'Success'
        SKIPPED = 'SKIPPED', 'Skipped'
        FAILED = 'FAILED', 'Failed'

    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    operation = models.CharField(max_length=10, choices=Operation.choices)
    status = models.CharField(max_length=10, choices=Status.choices)
    source = models.URLField(max_length=300)
    parsed_count = models.PositiveIntegerField(default=0)
    valid_count = models.PositiveIntegerField(default=0)
    inserted_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    unchanged_count = models.PositiveIntegerField(default=0)
    rejected_count = models.PositiveIntegerField(default=0)
    error_summary = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = 'wealth_scheme_catalogue_import_logs'
        ordering = ['-started_at', '-id']


class SchemeCatalogueRunLock(models.Model):
    """Singleton row used to serialize initialization and refresh operations."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)

    class Meta:
        db_table = 'wealth_scheme_catalogue_run_lock'
