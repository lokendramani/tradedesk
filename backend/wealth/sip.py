import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from .models import WealthMFTransactionDetail, WealthSIPInstallment, WealthSIPMandate


def calculate_sip_purchase_values(scheduled_amount, nav, purchase_date, actual_charges=None, charges_source=None):
    """Deduct charges from the scheduled total debit before calculating invested units."""
    total_amount = Decimal(scheduled_amount).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    nav = Decimal(nav).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    automatic_charges = (
        (total_amount * Decimal('0.00005')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if purchase_date >= date(2020, 7, 1) else Decimal('0.00')
    )
    charges = Decimal(actual_charges).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP) if actual_charges is not None else automatic_charges
    amount = total_amount - charges
    units = (amount / nav).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    source = charges_source or (
        WealthMFTransactionDetail.ChargesSource.AUTOMATIC
        if actual_charges is None else WealthMFTransactionDetail.ChargesSource.MANUAL
    )
    return {
        'units': units,
        'amount': amount,
        'total_amount': total_amount,
        'charges': charges,
        'cashflow': -total_amount,
        'charges_source': source,
        'charges_breakdown': (
            {'stamp_duty': f'{charges:.2f}'} if charges and source == WealthMFTransactionDetail.ChargesSource.AUTOMATIC
            else ({'statement_charges': f'{charges:.2f}'} if charges else {})
        ),
    }


def monthly_installment_date(year, month, sip_day):
    """Return the requested monthly day, clamped to the month's last day."""
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(int(sip_day), last_day))


def _next_month(year, month):
    return (year + 1, 1) if month == 12 else (year, month + 1)


def generate_due_installments(mandate, through_date=None):
    """Lazily persist due installments; this intentionally is not a background job."""
    through_date = through_date or timezone.localdate()
    if mandate.status != WealthSIPMandate.Status.ACTIVE:
        return 0

    first_date = max(mandate.start_date, mandate.generate_from_date)
    if mandate.generated_through:
        cursor_month = _next_month(mandate.generated_through.year, mandate.generated_through.month)
        if date(*cursor_month, 1) > through_date:
            return 0
        year, month = cursor_month
    else:
        year, month = first_date.year, first_date.month

    created = 0
    processed_through = mandate.generated_through
    while date(year, month, 1) <= through_date:
        scheduled_date = monthly_installment_date(year, month, mandate.sip_day)
        if scheduled_date > through_date:
            break

        within_end_date = mandate.end_date is None or scheduled_date <= mandate.end_date
        if scheduled_date >= first_date and within_end_date:
            _, was_created = WealthSIPInstallment.objects.get_or_create(
                mandate=mandate,
                scheduled_date=scheduled_date,
                defaults={'amount': mandate.monthly_amount},
            )
            created += int(was_created)
        processed_through = date(year, month, calendar.monthrange(year, month)[1])
        year, month = _next_month(year, month)

    updates = []
    if processed_through and processed_through != mandate.generated_through:
        mandate.generated_through = processed_through
        updates.append('generated_through')
    if mandate.end_date and mandate.end_date <= through_date and mandate.status != WealthSIPMandate.Status.COMPLETED:
        mandate.status = WealthSIPMandate.Status.COMPLETED
        updates.append('status')
    if updates:
        mandate.save(update_fields=updates + ['updated_at'])
    return created


def generate_for_active_mandates(user, through_date=None):
    """Catch up due rows when the SIP screen/API is accessed."""
    total = 0
    mandates = WealthSIPMandate.objects.filter(
        user=user,
        status=WealthSIPMandate.Status.ACTIVE,
    ).order_by('start_date', 'id')
    for mandate in mandates:
        with transaction.atomic():
            locked = WealthSIPMandate.objects.select_for_update().get(pk=mandate.pk, user=user)
            total += generate_due_installments(locked, through_date)
    return total
