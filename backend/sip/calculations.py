"""
SIP calculation pipeline.

recalculate_for_user(user, fetch_prices=False)
  fetch_prices=False  — reads only from SIPPriceCache (instant, no HTTP)
  fetch_prices=True   — bulk-fetches yfinance first, then recalculates

Dashboard GET uses fetch_prices=False.
Refresh Prices POST uses fetch_prices=True.

Performance: all snapshot writes use bulk_create(update_conflicts) or bulk_update
so recalculate is O(1) DB round-trips regardless of weeks/trades count.
"""
import uuid
import logging
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from .models import SIPTrade, SIPWeeklySnapshot, SIPBenchmarkPrice, SIPPriceCache
from .price_service import bulk_prefetch_history, batch_fetch_current, BENCHMARK_TICKERS

logger = logging.getLogger(__name__)

BENCHMARK_N50  = '^NSEI'
BENCHMARK_N500 = '^CRSLDX'
D0 = Decimal('0')
D4 = Decimal('0.0001')


def _d(val) -> Decimal:
    return Decimal(str(val)).quantize(D4, rounding=ROUND_HALF_UP)


# ─── In-memory price cache lookup ────────────────────────────────────────────

def _load_price_map(tickers: list) -> dict:
    """Load all SIPPriceCache rows for tickers into {(ticker, date): (price, stale)}."""
    entries = SIPPriceCache.objects.filter(ticker__in=tickers)
    m: dict = {}
    for e in entries:
        m[(e.ticker, e.price_date)] = (e.close_price, e.is_stale)
    return m


def _price_on_or_before(price_map: dict, ticker: str, target: date) -> tuple:
    check = target
    for _ in range(10):
        hit = price_map.get((ticker, check))
        if hit is not None:
            return hit
        check -= timedelta(days=1)
    return None, True


def _latest_price(price_map: dict, ticker: str) -> tuple:
    candidates = [(d, v) for (t, d), v in price_map.items() if t == ticker]
    if not candidates:
        return None, True
    _, (price, stale) = max(candidates, key=lambda x: x[0])
    return price, stale


# ─── 5a. Fresh-cash carry-forward ────────────────────────────────────────────

def compute_fresh_cash(user, trades: list) -> dict:
    if not trades:
        SIPWeeklySnapshot.objects.filter(user=user).delete()
        return {}

    weeks = sorted({t.trade_date for t in trades})

    exits_by_date: dict = defaultdict(Decimal)
    for t in trades:
        if t.exit_date and t.exit_value is not None:
            exits_by_date[t.exit_date] += _d(t.exit_value)

    carry = D0
    cum_fresh = D0
    fresh_by_week: dict = {}
    new_snapshots: list = []

    for idx, week in enumerate(weeks):
        prev_week = weeks[idx - 1] if idx > 0 else None

        if prev_week is not None:
            for d_, proceeds in exits_by_date.items():
                if prev_week < d_ < week:
                    carry += proceeds

        exits_this_week = exits_by_date.get(week, D0)
        weekly_buy = sum((_d(t.trade_value) for t in trades if t.trade_date == week), D0)
        available  = carry + exits_this_week
        recycled   = min(available, weekly_buy)
        fresh      = weekly_buy - recycled
        carry      = available - recycled
        cum_fresh += fresh

        fresh_by_week[week] = fresh
        new_snapshots.append(SIPWeeklySnapshot(
            id=uuid.uuid4(),
            user=user,
            week_date=week,
            weekly_buy=weekly_buy,
            exits_recycled=recycled,
            fresh_cash=fresh,
            cumulative_fresh=cum_fresh,
        ))

    with transaction.atomic():
        # Delete stale weeks, then upsert all in 2 DB round-trips total
        SIPWeeklySnapshot.objects.filter(user=user).exclude(week_date__in=weeks).delete()
        SIPWeeklySnapshot.objects.bulk_create(
            new_snapshots,
            update_conflicts=True,
            update_fields=['weekly_buy', 'exits_recycled', 'fresh_cash', 'cumulative_fresh'],
            unique_fields=['user', 'week_date'],
        )

    return fresh_by_week


# ─── 5b. Active holdings (cache-only) ────────────────────────────────────────

def compute_current_holdings(trades: list, price_map: dict) -> list:
    open_trades = [t for t in trades if t.exit_date is None]
    if not open_trades:
        return []

    today = date.today()
    holdings: dict = defaultdict(lambda: {'etf_name': '', 'qty': D0, 'invested': D0})
    for t in open_trades:
        h = holdings[t.ticker]
        h['etf_name'] = t.etf_name
        h['qty']     += _d(t.qty)
        h['invested'] += _d(t.trade_value)

    result = []
    for ticker, h in holdings.items():
        price, is_stale = _price_on_or_before(price_map, ticker, today)
        if price is not None:
            current_value = _d(h['qty']) * _d(price)
            pl     = current_value - h['invested']
            pl_pct = (pl / h['invested'] * 100) if h['invested'] else D0
        else:
            current_value = pl = pl_pct = None

        result.append({
            'ticker':        ticker,
            'etf_name':      h['etf_name'],
            'qty':           float(h['qty']),
            'invested':      float(h['invested']),
            'current_value': float(current_value) if current_value is not None else None,
            'pl':            float(pl)     if pl     is not None else None,
            'pl_pct':        float(pl_pct) if pl_pct is not None else None,
            'price_stale':   is_stale,
        })

    result.sort(key=lambda x: (x['pl'] or 0), reverse=True)
    return result


# ─── 5c. Booked P&L ──────────────────────────────────────────────────────────

def compute_booked_pl(trades: list) -> tuple:
    by_ticker: dict = defaultdict(lambda: {'etf_name': '', 'booked_pl': D0, 'trade_count': 0})
    for t in trades:
        if t.exit_date is None:
            continue
        b = by_ticker[t.ticker]
        b['etf_name'] = t.etf_name
        b['booked_pl'] += _d(t.exit_value or 0) - _d(t.trade_value)
        b['trade_count'] += 1

    total = sum(v['booked_pl'] for v in by_ticker.values())
    rows = [
        {'ticker': tk, 'etf_name': v['etf_name'],
         'booked_pl': float(v['booked_pl']), 'trade_count': v['trade_count']}
        for tk, v in by_ticker.items()
    ]
    rows.sort(key=lambda x: x['booked_pl'], reverse=True)
    return float(total), rows


# ─── 5d. Historical weekly portfolio value (cache-only) ───────────────────────

def compute_weekly_portfolio_values(snapshots: list, trades: list, price_map: dict) -> None:
    """Mutates snapshot.portfolio_value in-place and bulk_updates in one DB call."""
    if not snapshots or not trades:
        return

    today     = date.today()
    last_week = snapshots[-1].week_date

    for snap in snapshots:
        week   = snap.week_date
        target = today if week == last_week else week
        held   = [t for t in trades
                  if t.trade_date <= week and (t.exit_date is None or t.exit_date > week)]
        if not held:
            snap.portfolio_value = D0
            continue

        total = D0
        for t in held:
            price, _ = _price_on_or_before(price_map, t.ticker, target)
            if price is not None:
                total += _d(t.qty) * _d(price)
        snap.portfolio_value = total

    # Single bulk_update — 1 DB round-trip regardless of snapshot count
    SIPWeeklySnapshot.objects.bulk_update(snapshots, ['portfolio_value'])


# ─── 5e. XIRR ────────────────────────────────────────────────────────────────

def compute_xirr(cashflows: list) -> float | None:
    if len(cashflows) < 2:
        return None

    t0      = cashflows[0][0]
    times   = [((d - t0).days / 365.0) for d, _ in cashflows]
    amounts = [float(a) for _, a in cashflows]

    def npv(r: float) -> float:
        return sum(a / (1 + r) ** t for a, t in zip(amounts, times))

    def npv_d(r: float) -> float:
        return sum(-t * a / (1 + r) ** (t + 1) for a, t in zip(amounts, times))

    guess = 0.1
    for _ in range(200):
        try:
            f, fp = npv(guess), npv_d(guess)
            if abs(fp) < 1e-12:
                break
            new = guess - f / fp
            if abs(new - guess) < 1e-7:
                return round(new, 6)
            guess = new
            if guess <= -1:
                guess = -0.99
        except (ZeroDivisionError, OverflowError):
            break
    return None


# ─── 5f. Benchmark XIRR (cache-only) ─────────────────────────────────────────

def compute_benchmark_xirr(fresh_by_week: dict, price_map: dict) -> dict:
    weeks     = sorted(fresh_by_week.keys())
    today     = date.today()
    n50_units = n500_units = Decimal('0')
    n50_cfs:  list = []
    n500_cfs: list = []
    missing_weeks = 0

    bench_upserts: dict = {}

    for week in weeks:
        fresh = _d(fresh_by_week[week])
        if fresh <= 0:
            continue

        n50_price,  _ = _price_on_or_before(price_map, BENCHMARK_N50,  week)
        n500_price, _ = _price_on_or_before(price_map, BENCHMARK_N500, week)

        if n50_price:
            n50_units += fresh / _d(n50_price)
            n50_cfs.append((week, float(-fresh)))
            bench_upserts.setdefault(week, {})['nifty50_price'] = n50_price

        if n500_price:
            n500_units += fresh / _d(n500_price)
            n500_cfs.append((week, float(-fresh)))
            bench_upserts.setdefault(week, {})['nifty500_price'] = n500_price

        if not n50_price or not n500_price:
            missing_weeks += 1

    # Persist benchmark prices — single bulk upsert, not N round-trips
    if bench_upserts:
        rows = [
            SIPBenchmarkPrice(week_date=week, **vals)
            for week, vals in bench_upserts.items()
        ]
        update_fields = list({f for vals in bench_upserts.values() for f in vals})
        SIPBenchmarkPrice.objects.bulk_create(
            rows,
            update_conflicts=True,
            update_fields=update_fields,
            unique_fields=['week_date'],
        )

    n50_cmp,  _ = _latest_price(price_map, BENCHMARK_N50)
    n500_cmp, _ = _latest_price(price_map, BENCHMARK_N500)

    n50_xirr = n500_xirr = None

    if n50_cmp and n50_units > 0:
        n50_cfs.append((today, float(n50_units * _d(n50_cmp))))
        n50_xirr = compute_xirr(n50_cfs)

    if n500_cmp and n500_units > 0:
        n500_cfs.append((today, float(n500_units * _d(n500_cmp))))
        n500_xirr = compute_xirr(n500_cfs)

    return {
        'n50_xirr':               round(n50_xirr  * 100, 2) if n50_xirr  is not None else None,
        'n500_xirr':              round(n500_xirr * 100, 2) if n500_xirr is not None else None,
        'benchmark_missing_weeks': missing_weeks,
    }


# ─── Master entry-point ───────────────────────────────────────────────────────

def recalculate_for_user(user, fetch_prices: bool = False) -> dict:
    """
    fetch_prices=False  — DB/cache only, fast (dashboard GET)
    fetch_prices=True   — fetches from yfinance first (refresh-prices POST)
    """
    trades = list(SIPTrade.objects.filter(user=user))

    if fetch_prices and trades:
        all_tickers = list({t.ticker for t in trades})
        benchmarks  = list(BENCHMARK_TICKERS)
        earliest    = min(t.trade_date for t in trades)
        bulk_prefetch_history(all_tickers + benchmarks, earliest, date.today())
        batch_fetch_current(all_tickers + benchmarks)

    # Load all prices from DB into memory — single SELECT
    all_tickers_needed = list({t.ticker for t in trades} | BENCHMARK_TICKERS)
    price_map = _load_price_map(all_tickers_needed)

    fresh_by_week             = compute_fresh_cash(user, trades)
    # Fetch snapshots once — reused for portfolio_value update and final assembly
    snapshots                 = list(SIPWeeklySnapshot.objects.filter(user=user).order_by('week_date'))
    holdings                  = compute_current_holdings(trades, price_map)
    total_booked, booked_rows = compute_booked_pl(trades)
    compute_weekly_portfolio_values(snapshots, trades, price_map)
    fresh_invested  = float(snapshots[-1].cumulative_fresh) if snapshots else 0.0
    portfolio_value = sum(h['current_value'] or 0 for h in holdings)
    unrealised_pl   = portfolio_value - sum(h['invested'] for h in holdings)
    has_stale       = any(h['price_stale'] for h in holdings)

    today = date.today()
    xirr_cfs: list = []
    for snap in snapshots:
        xirr_cfs.append((snap.week_date, float(-snap.weekly_buy)))
    for t in trades:
        if t.exit_date:
            xirr_cfs.append((t.exit_date, float(t.exit_value or 0)))
    if portfolio_value > 0:
        xirr_cfs.append((today, portfolio_value))
    xirr_cfs.sort(key=lambda x: x[0])
    your_xirr     = compute_xirr(xirr_cfs)
    your_xirr_pct = round(your_xirr * 100, 2) if your_xirr is not None else None

    bench      = compute_benchmark_xirr(fresh_by_week, price_map)
    alpha_n50  = (round(your_xirr_pct - bench['n50_xirr'],  2)
                  if your_xirr_pct is not None and bench['n50_xirr']  is not None else None)
    alpha_n500 = (round(your_xirr_pct - bench['n500_xirr'], 2)
                  if your_xirr_pct is not None and bench['n500_xirr'] is not None else None)

    weekly_chart = [
        {
            'week':             snap.week_date.isoformat(),
            'cumulative_fresh': float(snap.cumulative_fresh),
            'portfolio_value':  float(snap.portfolio_value) if snap.portfolio_value is not None else None,
        }
        for snap in snapshots
    ]

    return {
        'summary': {
            'fresh_invested':          fresh_invested,
            'portfolio_value':         portfolio_value,
            'unrealised_pl':           unrealised_pl,
            'booked_pl':               total_booked,
            'your_xirr':               your_xirr_pct,
            'n50_xirr':                bench['n50_xirr'],
            'n500_xirr':               bench['n500_xirr'],
            'alpha_n50':               alpha_n50,
            'alpha_n500':              alpha_n500,
            'has_stale_prices':        has_stale,
            'benchmark_missing_weeks': bench['benchmark_missing_weeks'],
        },
        'active_holdings':     holdings,
        'booked_pl_by_ticker': booked_rows,
        'weekly_chart_data':   weekly_chart,
    }
