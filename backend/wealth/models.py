import uuid
from decimal import Decimal, ROUND_HALF_UP, localcontext

from django.conf import settings
from django.core.exceptions import ValidationError
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
    fund_house_master = models.ForeignKey(
        'WealthFundHouse',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='schemes',
    )
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


class WealthFundHouse(models.Model):
    """Normalized Wealth AMC identity; distinct legacy labels stay distinct."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=180, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_fund_houses'
        ordering = ['name']

    def __str__(self):
        return self.name


class WealthFolio(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='wealth_folios',
    )
    folio_number = models.CharField(max_length=80)
    fund_house = models.ForeignKey(
        WealthFundHouse,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='folios',
    )
    name = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_folios'
        ordering = ['folio_number', 'id']
        constraints = [
            models.UniqueConstraint(fields=['user', 'folio_number'], name='uniq_wealth_user_folio'),
        ]

    def clean(self):
        self.folio_number = self.folio_number.strip()
        if not self.folio_number:
            raise ValidationError({'folio_number': 'Folio number cannot be blank.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return self.folio_number


class WealthInstrument(models.Model):
    class InstrumentType(models.TextChoices):
        MUTUAL_FUND = 'MUTUAL_FUND', 'Mutual fund'
        OTHER = 'OTHER', 'Other'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    instrument_type = models.CharField(
        max_length=20,
        choices=InstrumentType.choices,
        default=InstrumentType.MUTUAL_FUND,
    )
    scheme = models.OneToOneField(
        MutualFundScheme,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='wealth_instrument',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_instruments'
        ordering = ['instrument_type', 'id']

    def clean(self):
        if self.instrument_type == self.InstrumentType.MUTUAL_FUND and not self.scheme_id:
            raise ValidationError({'scheme': 'Mutual fund instruments require a catalogue scheme.'})
        if self.instrument_type != self.InstrumentType.MUTUAL_FUND and self.scheme_id:
            raise ValidationError({'scheme': 'Only mutual fund instruments can reference a catalogue scheme.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return self.scheme.scheme_name if self.scheme_id else self.get_instrument_type_display()


class WealthTransaction(models.Model):
    class TransactionType(models.TextChoices):
        PURCHASE = 'PURCHASE', 'Purchase'
        REDEMPTION = 'REDEMPTION', 'Redemption'
        SWITCH_OUT = 'SWITCH_OUT', 'Switch out'
        SWITCH_IN = 'SWITCH_IN', 'Switch in'
        DIVIDEND = 'DIVIDEND', 'Dividend'
        BONUS = 'BONUS', 'Bonus'
        OTHER = 'OTHER', 'Other'

    class Source(models.TextChoices):
        MANUAL = 'MANUAL', 'Manual'
        SIP = 'SIP', 'SIP'
        IMPORT = 'IMPORT', 'Import'
        OTHER = 'OTHER', 'Other'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='wealth_transactions',
    )
    instrument = models.ForeignKey(
        WealthInstrument,
        on_delete=models.PROTECT,
        related_name='transactions',
    )
    folio = models.ForeignKey(
        WealthFolio,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='transactions',
    )
    transaction_type = models.CharField(max_length=12, choices=TransactionType.choices)
    transaction_date = models.DateField()
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    source_reference = models.CharField(max_length=120, blank=True)
    switch_group_id = models.UUIDField(null=True, blank=True, db_index=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_transactions'
        ordering = ['-transaction_date', '-created_at', '-id']
        indexes = [
            models.Index(fields=['user', 'transaction_date'], name='wealth_tx_user_date_idx'),
            models.Index(fields=['instrument', 'transaction_date'], name='wealth_tx_inst_date_idx'),
        ]
        constraints = [
            models.CheckConstraint(
                check=(Q(transaction_type__in=['SWITCH_OUT', 'SWITCH_IN'], switch_group_id__isnull=False)
                       | (~Q(transaction_type__in=['SWITCH_OUT', 'SWITCH_IN']) & Q(switch_group_id__isnull=True))),
                name='wealth_switch_type_group_consistent',
            ),
            models.CheckConstraint(
                check=(~Q(source='SIP') | Q(transaction_type='PURCHASE')),
                name='wealth_sip_source_purchase_only',
            ),
        ]

    def clean(self):
        errors = {}
        if self.folio_id and self.user_id and self.folio.user_id != self.user_id:
            errors['folio'] = 'Choose one of your own folios.'
        if self.instrument_id and self.folio_id:
            scheme = self.instrument.scheme if self.instrument.scheme_id else None
            if scheme and self.folio.fund_house_id and scheme.fund_house_master_id != self.folio.fund_house_id:
                errors['folio'] = 'Folio fund house must match the selected mutual fund scheme.'
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class WealthMFTransactionDetail(models.Model):
    class ChargesSource(models.TextChoices):
        AUTOMATIC = 'AUTOMATIC', 'Automatic'
        MANUAL = 'MANUAL', 'Manual'
        MIXED = 'MIXED', 'Mixed'

    transaction = models.OneToOneField(
        WealthTransaction,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name='mf_detail',
    )
    units = models.DecimalField(max_digits=22, decimal_places=4, default=Decimal('0'))
    nav = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    charges = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    charges_source = models.CharField(
        max_length=10,
        choices=ChargesSource.choices,
        default=ChargesSource.MANUAL,
    )
    charges_breakdown = models.JSONField(default=dict, blank=True)
    cashflow = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_mf_transaction_details'

    def clean(self):
        errors = {}
        transaction_record = getattr(self, 'transaction', None)
        transaction_type = getattr(transaction_record, 'transaction_type', None)
        transaction_source = getattr(transaction_record, 'source', None)
        if self.units < 0:
            errors['units'] = 'Units cannot be negative.'
        if self.nav < 0:
            errors['nav'] = 'NAV cannot be negative.'
        if self.amount < 0:
            errors['amount'] = 'Amount cannot be negative.'
        if self.charges < 0:
            errors['charges'] = 'Charges cannot be negative.'

        unit_transactions = {
            WealthTransaction.TransactionType.PURCHASE,
            WealthTransaction.TransactionType.REDEMPTION,
            WealthTransaction.TransactionType.SWITCH_OUT,
            WealthTransaction.TransactionType.SWITCH_IN,
        }
        if transaction_type in unit_transactions and self.units <= 0:
            errors['units'] = 'Units must be greater than zero for this transaction type.'
        if transaction_type in unit_transactions and self.nav <= 0:
            errors['nav'] = 'NAV must be greater than zero for this transaction type.'
        if transaction_type in unit_transactions and self.amount <= 0:
            errors['amount'] = 'Amount must be greater than zero for this transaction type.'

        if transaction_type in unit_transactions and self.units > 0 and self.nav > 0:
            if (
                transaction_type == WealthTransaction.TransactionType.PURCHASE
                and transaction_source == WealthTransaction.Source.SIP
            ):
                expected_units = (self.amount / self.nav).quantize(
                    Decimal('0.0001'), rounding=ROUND_HALF_UP,
                )
                if self.amount > 0 and self.units != expected_units:
                    errors['units'] = 'SIP purchase units must equal net amount divided by NAV, rounded to four decimal places.'
                expected_cashflow = -(self.amount + self.charges)
                if self.cashflow != expected_cashflow:
                    errors['cashflow'] = 'SIP purchase cashflow must equal the negative total debit (amount plus charges).'
            else:
                expected_amount = (self.units * self.nav).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                if self.amount != expected_amount:
                    errors['amount'] = 'Amount must equal units multiplied by NAV, rounded to two decimal places.'

        debit_types = {
            WealthTransaction.TransactionType.PURCHASE,
            WealthTransaction.TransactionType.SWITCH_IN,
        }
        credit_types = {
            WealthTransaction.TransactionType.REDEMPTION,
            WealthTransaction.TransactionType.SWITCH_OUT,
            WealthTransaction.TransactionType.DIVIDEND,
        }
        if transaction_type in debit_types:
            if self.cashflow >= 0:
                errors['cashflow'] = 'Cashflow for a purchase or switch-in must be negative.'
        elif transaction_type in credit_types:
            if self.amount <= 0:
                errors['amount'] = 'Amount must be greater than zero for this transaction type.'
            if self.cashflow <= 0:
                errors['cashflow'] = 'Cashflow for a redemption, switch-out, or dividend must be positive.'
        elif transaction_type == WealthTransaction.TransactionType.BONUS:
            if self.units <= 0:
                errors['units'] = 'Bonus units must be greater than zero.'
            if self.cashflow != 0 or self.charges != 0:
                errors['cashflow'] = 'Bonus transactions cannot have a cashflow or charges.'
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class WealthTransactionAudit(models.Model):
    class Action(models.TextChoices):
        CREATED = 'CREATED', 'Created'
        UPDATED = 'UPDATED', 'Updated'
        DELETED = 'DELETED', 'Deleted'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        WealthTransaction,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='audit_history',
    )
    transaction_id_snapshot = models.UUIDField(db_index=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='wealth_transaction_audits',
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='wealth_transaction_audit_actions',
    )
    action = models.CharField(max_length=10, choices=Action.choices)
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'wealth_transaction_audits'
        ordering = ['-created_at', '-id']


class WealthSIPMandate(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        PAUSED = 'PAUSED', 'Paused'
        COMPLETED = 'COMPLETED', 'Completed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='wealth_sip_mandates',
    )
    scheme = models.ForeignKey(
        MutualFundScheme,
        on_delete=models.PROTECT,
        related_name='wealth_sip_mandates',
    )
    folio = models.ForeignKey(
        WealthFolio,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='sip_mandates',
    )
    monthly_amount = models.DecimalField(max_digits=18, decimal_places=2)
    sip_day = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(31)])
    start_date = models.DateField()
    generate_from_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    generated_through = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_sip_mandates'
        ordering = ['-created_at', '-id']

    def clean(self):
        errors = {}
        if self.monthly_amount is not None and self.monthly_amount <= 0:
            errors['monthly_amount'] = 'Monthly amount must be greater than zero.'
        if self.start_date and self.generate_from_date and self.generate_from_date < self.start_date:
            errors['generate_from_date'] = 'Installments cannot be generated before the SIP start date.'
        if self.start_date and self.end_date and self.end_date < self.start_date:
            errors['end_date'] = 'End date cannot be before the SIP start date.'
        if self.folio_id and self.user_id and self.folio.user_id != self.user_id:
            errors['folio'] = 'Choose one of your own folios.'
        if self.folio_id and self.folio.fund_house_id and self.scheme_id:
            if self.scheme.fund_house_master_id != self.folio.fund_house_id:
                errors['folio'] = 'Folio fund house must match the selected scheme.'
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class WealthSIPInstallment(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        CONFIRMED = 'CONFIRMED', 'Confirmed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mandate = models.ForeignKey(
        WealthSIPMandate,
        on_delete=models.CASCADE,
        related_name='installments',
    )
    scheduled_date = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    transaction = models.OneToOneField(
        WealthTransaction,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='sip_installment',
    )
    transaction_id_snapshot = models.UUIDField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_sip_installments'
        ordering = ['scheduled_date', 'id']
        constraints = [
            models.UniqueConstraint(fields=['mandate', 'scheduled_date'], name='uniq_wealth_sip_installment_date'),
        ]

    def clean(self):
        errors = {}
        if self.amount is not None and self.amount <= 0:
            errors['amount'] = 'Installment amount must be greater than zero.'
        if self.scheduled_date and self.mandate_id:
            if self.scheduled_date < self.mandate.start_date:
                errors['scheduled_date'] = 'Installment cannot precede the SIP start date.'
            if self.mandate.end_date and self.scheduled_date > self.mandate.end_date:
                errors['scheduled_date'] = 'Installment cannot fall after the SIP end date.'
        if self.transaction_id and self.transaction_id_snapshot != self.transaction_id:
            self.transaction_id_snapshot = self.transaction_id
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class WealthMFNAVHistory(models.Model):
    class Source(models.TextChoices):
        MFAPI = 'MFAPI', 'MFAPI'
        AMFI = 'AMFI', 'AMFI'

    scheme = models.ForeignKey(
        MutualFundScheme,
        on_delete=models.PROTECT,
        related_name='nav_history',
    )
    nav_date = models.DateField()
    nav = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        validators=[MinValueValidator(Decimal('0.0001'))],
    )
    source = models.CharField(max_length=8, choices=Source.choices)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_mf_nav_history'
        ordering = ['nav_date']
        constraints = [
            models.UniqueConstraint(fields=['scheme', 'nav_date'], name='uniq_wealth_mf_nav_date'),
            models.CheckConstraint(check=Q(nav__gt=0), name='wealth_mf_nav_positive'),
        ]
        indexes = [
            models.Index(fields=['scheme', '-nav_date'], name='wealth_mf_nav_latest_idx'),
        ]

    def clean(self):
        errors = {}
        if self.nav is not None and self.nav <= 0:
            errors['nav'] = 'NAV must be positive.'
        if self.nav_date and self.nav_date > timezone.localdate():
            errors['nav_date'] = 'NAV date cannot be in the future.'
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f'{self.scheme.scheme_code} {self.nav_date} {self.nav}'


class WealthMFNAVHistoryLoad(models.Model):
    scheme = models.OneToOneField(
        MutualFundScheme,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name='nav_history_load',
    )
    history_loaded_at = models.DateTimeField(null=True, blank=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    error_summary = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = 'wealth_mf_nav_history_loads'


class WealthMFNAVUpdateRun(models.Model):
    class Status(models.TextChoices):
        RUNNING = 'RUNNING', 'Running'
        SUCCESS = 'SUCCESS', 'Success'
        PARTIAL = 'PARTIAL', 'Partial'
        FAILED = 'FAILED', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trigger_type = models.CharField(max_length=20, default='ADMIN_MANUAL')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RUNNING)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='wealth_mf_nav_update_runs',
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    held_scheme_count = models.PositiveIntegerField(default=0)
    inserted_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    error_summary = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = 'wealth_mf_nav_update_runs'
        ordering = ['-started_at', '-id']


class WealthMFNAVUpdateLock(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    active_run = models.ForeignKey(
        WealthMFNAVUpdateRun,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='active_lock_rows',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'wealth_mf_nav_update_lock'
