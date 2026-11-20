from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Case, DecimalField, F, Sum, Value, When

from .models import WealthInstrument, WealthTransaction


def wealth_unit_delta_expression():
    """Return the signed MF unit movement used by Wealth holdings accounting."""
    return Case(
        When(transaction_type__in=[
            WealthTransaction.TransactionType.PURCHASE,
            WealthTransaction.TransactionType.SWITCH_IN,
            WealthTransaction.TransactionType.BONUS,
        ], then=F('mf_detail__units')),
        When(transaction_type__in=[
            WealthTransaction.TransactionType.REDEMPTION,
            WealthTransaction.TransactionType.SWITCH_OUT,
        ], then=-F('mf_detail__units')),
        default=Value(0),
        output_field=DecimalField(max_digits=22, decimal_places=6),
    )


def calculate_moving_average_cost(transactions):
    """Calculate moving-average cost and realized/income totals for ordered transactions."""
    units = Decimal('0')
    invested_cost = Decimal('0')
    realized_pl = Decimal('0')
    dividend_income = Decimal('0')
    reliable = True

    def detail_value(record, key):
        detail = record.get('mf_detail') if isinstance(record, dict) else record.mf_detail
        value = detail.get(key) if isinstance(detail, dict) else getattr(detail, key)
        return Decimal(str(value or '0'))

    def record_value(record, key):
        return record.get(key) if isinstance(record, dict) else getattr(record, key)

    ordered = sorted(transactions, key=lambda item: (
        record_value(item, 'transaction_date'),
        str(record_value(item, 'created_at') or ''),
        str(record_value(item, 'id') or ''),
    ))
    for record in ordered:
        transaction_type = record_value(record, 'transaction_type')
        units_delta = detail_value(record, 'units')
        amount = detail_value(record, 'amount')
        charges = detail_value(record, 'charges')
        cashflow = detail_value(record, 'cashflow')

        if transaction_type in {'PURCHASE', 'SWITCH_IN'}:
            if units < 0:
                reliable = False
            units += units_delta
            invested_cost += amount + charges
        elif transaction_type in {'REDEMPTION', 'SWITCH_OUT'}:
            if units > 0:
                removed_units = min(units, units_delta)
                removed_cost = (invested_cost * removed_units / units).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                invested_cost = max(Decimal('0'), invested_cost - removed_cost)
                units -= units_delta
                realized_pl += cashflow - removed_cost
            else:
                units -= units_delta
                reliable = False
            if units < 0:
                invested_cost = Decimal('0')
                reliable = False
        elif transaction_type == 'BONUS':
            units += units_delta
        elif transaction_type == 'DIVIDEND':
            dividend_income += cashflow

        if units == 0:
            invested_cost = Decimal('0')
            reliable = True

    if units <= 0 or not reliable:
        return {
            'units': units,
            'average_cost_nav': None,
            'invested_cost': None,
            'realized_pl': realized_pl.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            'dividend_income': dividend_income.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            'reliable': reliable,
        }

    return {
        'units': units,
        'average_cost_nav': (invested_cost / units).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP),
        'invested_cost': invested_cost.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
        'realized_pl': realized_pl.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
        'dividend_income': dividend_income.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
        'reliable': True,
    }


def wealth_moving_average_positions(user):
    """Return derived cost states keyed by scheme and folio for one user."""
    transactions = list(WealthTransaction.objects.filter(
        user=user,
        instrument__instrument_type=WealthInstrument.InstrumentType.MUTUAL_FUND,
        instrument__scheme__isnull=False,
    ).select_related('instrument__scheme', 'mf_detail').order_by(
        'transaction_date', 'created_at', 'id',
    ))
    grouped = {}
    for item in transactions:
        key = (item.instrument.scheme_id, item.folio_id)
        grouped.setdefault(key, []).append(item)
    return {key: calculate_moving_average_cost(records) for key, records in grouped.items()}


def wealth_folio_positions():
    """Return net units per user, scheme, and folio, including the unassigned folio."""
    signed_units = wealth_unit_delta_expression()
    transactions = WealthTransaction.objects.filter(
        instrument__instrument_type=WealthInstrument.InstrumentType.MUTUAL_FUND,
        instrument__scheme__isnull=False,
    )
    return (
        transactions.order_by()
        .values('user_id', 'instrument__scheme_id', 'folio_id')
        .annotate(units=Sum(signed_units))
    )


def wealth_folio_position_summary():
    """Return NAV-eligible schemes and negative-position diagnostics from one query."""
    positions = list(wealth_folio_positions())
    return {
        'positive_scheme_ids': list({
            position['instrument__scheme_id']
            for position in positions
            if position['units'] is not None and position['units'] > 0
        }),
        'negative_folio_positions': sum(
            position['units'] is not None and position['units'] < 0
            for position in positions
        ),
    }


def positive_held_scheme_ids():
    """Return schemes with a positive position in at least one user/folio."""
    return wealth_folio_position_summary()['positive_scheme_ids']


def negative_folio_position_count():
    """Count negative per-user/folio positions for run diagnostics."""
    return wealth_folio_position_summary()['negative_folio_positions']
