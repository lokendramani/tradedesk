import logging
from datetime import datetime
from decimal import Decimal

from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import SIPTrade, SIPWeeklySnapshot, SIPBenchmarkPrice, SIPPriceCache, SIPETFMaster
from .parser import parse_sip_csv
from .calculations import recalculate_for_user
from .price_service import batch_fetch_current, BENCHMARK_TICKERS

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload_csv(request):
    f = request.FILES.get('file')
    if not f:
        return Response({'error': 'No file uploaded'}, status=status.HTTP_400_BAD_REQUEST)

    valid_rows, errors, open_tickers = parse_sip_csv(f, request.user)

    if errors and not valid_rows:
        return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

    # bulk insert trades first — decoupled from price fetch
    objs = [
        SIPTrade(
            user=request.user,
            trade_date=r['trade_date'],
            etf_name=r['etf_name'],
            asset_class=r['asset_class'],
            ticker=r['ticker'],
            qty=r['qty'],
            price=r['price'],
            trade_value=round(r['qty'] * r['price'], 4),
            exit_date=r['exit_date'],
            exit_price=r['exit_price'],
            exit_value=round(r['qty'] * r['exit_price'], 4) if r['exit_price'] else None,
        )
        for r in valid_rows
    ]
    SIPTrade.objects.bulk_create(objs)

    # batch-fetch live CMP for all open-position tickers in one yfinance call
    price_refresh_ok = True
    if open_tickers:
        try:
            batch_fetch_current(list(open_tickers))
        except Exception as e:
            logger.warning('upload_csv: batch price fetch failed: %s', e)
            price_refresh_ok = False

    return Response({
        'imported':           len(objs),
        'duplicates_skipped': 0,
        'errors':             errors,
        'price_refresh_ok':   price_refresh_ok,
        'prices_fetched':     list(open_tickers),
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def trades_list_or_add(request):
    if request.method == 'GET':
        qs = SIPTrade.objects.filter(user=request.user).order_by('-trade_date', '-created_at')
        return Response([_trade_to_dict(t) for t in qs])
    # POST → add single trade
    return _add_trade(request)


def _add_trade(request):
    data = request.data
    required = ['trade_date', 'etf_name', 'asset_class', 'ticker', 'qty', 'price']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return Response({'error': f'Missing fields: {", ".join(missing)}'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        ticker   = str(data['ticker']).upper()
        etf_name = data['etf_name']
        try:
            etf_name = SIPETFMaster.objects.get(ticker=ticker).etf_name
        except SIPETFMaster.DoesNotExist:
            pass

        trade = SIPTrade(
            user=request.user,
            trade_date=data['trade_date'],
            etf_name=etf_name,
            asset_class=data['asset_class'],
            ticker=ticker,
            qty=data['qty'],
            price=data['price'],
            notes=data.get('notes', ''),
        )
        trade.save()
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    return Response(_trade_to_dict(trade), status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def close_trade(request, pk):
    try:
        trade = SIPTrade.objects.get(pk=pk, user=request.user)
    except SIPTrade.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    exit_date  = request.data.get('exit_date')
    exit_price = request.data.get('exit_price')
    if not exit_date or not exit_price:
        return Response({'error': 'exit_date and exit_price are required'}, status=status.HTTP_400_BAD_REQUEST)

    trade.exit_date  = exit_date
    trade.exit_price = exit_price
    trade.save()

    return Response(_trade_to_dict(trade))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard(request):
    data = recalculate_for_user(request.user)
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def refresh_prices(request):
    tickers = list(
        SIPTrade.objects.filter(user=request.user, exit_date__isnull=True)
        .values_list('ticker', flat=True)
        .distinct()
    )
    benchmarks = list(BENCHMARK_TICKERS)

    prices = batch_fetch_current(tickers + benchmarks)

    recalculate_for_user(request.user, fetch_prices=True)

    return Response({
        'refreshed_at':    datetime.now().isoformat(),
        'updated_tickers': list(prices.keys()),
    })


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def clear_data(request):
    """Wipe all SIP data for the current user."""
    user = request.user
    trades_deleted,  _ = SIPTrade.objects.filter(user=user).delete()
    SIPWeeklySnapshot.objects.filter(user=user).delete()
    # Price cache and benchmark prices are shared across users — don't delete those
    return Response({'deleted_trades': trades_deleted})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def holdings(request):
    """Aggregated active (open) holdings with latest CMP from price cache."""
    from collections import defaultdict
    from decimal import Decimal

    trades = list(SIPTrade.objects.filter(user=request.user, exit_date__isnull=True))

    if not trades:
        return Response({'holdings': [], 'total_invested': 0, 'total_current': None, 'has_stale_prices': False})

    # Aggregate by ticker
    by_ticker = defaultdict(lambda: {'etf_name': '', 'asset_class': '', 'qty': Decimal('0'), 'invested': Decimal('0')})
    for t in trades:
        h = by_ticker[t.ticker]
        h['etf_name']    = t.etf_name
        h['asset_class'] = t.asset_class
        h['qty']         += t.qty
        h['invested']    += t.trade_value

    # Override etf_name with canonical name from ETF master (covers old imported data)
    tickers = list(by_ticker.keys())
    master_names = {e.ticker: e.etf_name for e in SIPETFMaster.objects.filter(ticker__in=tickers)}
    for ticker_key, h in by_ticker.items():
        if ticker_key in master_names:
            h['etf_name'] = master_names[ticker_key]

    # Latest price per ticker — single SELECT, then iterate in Python
    latest_prices: dict = {}
    for pc in SIPPriceCache.objects.filter(ticker__in=tickers).order_by('ticker', '-price_date'):
        if pc.ticker not in latest_prices:
            latest_prices[pc.ticker] = (float(pc.close_price), pc.is_stale)

    result = []
    total_invested = Decimal('0')
    total_current  = Decimal('0')
    any_missing    = False

    for ticker, h in by_ticker.items():
        invested = h['invested']
        qty      = h['qty']
        total_invested += invested

        price_info = latest_prices.get(ticker)
        if price_info:
            cmp, is_stale   = price_info
            current_value   = float(qty) * cmp
            pl              = current_value - float(invested)
            pl_pct          = (pl / float(invested) * 100) if invested else 0
            total_current  += Decimal(str(round(current_value, 4)))
        else:
            cmp = current_value = pl = pl_pct = None
            is_stale  = True
            any_missing = True

        result.append({
            'ticker':        ticker,
            'etf_name':      h['etf_name'],
            'asset_class':   h['asset_class'],
            'qty':           float(qty),
            'avg_price':     round(float(invested / qty), 4) if qty else 0,
            'invested':      float(invested),
            'cmp':           cmp,
            'current_value': round(current_value, 2) if current_value is not None else None,
            'pl':            round(pl, 2)            if pl            is not None else None,
            'pl_pct':        round(pl_pct, 2)        if pl_pct        is not None else None,
            'price_stale':   is_stale,
        })

    result.sort(key=lambda x: x['invested'], reverse=True)

    last_snap = SIPWeeklySnapshot.objects.filter(user=request.user).order_by('-week_date').first()
    fresh_invested = float(last_snap.cumulative_fresh) if last_snap else None

    return Response({
        'holdings':         result,
        'total_invested':   float(total_invested),
        'total_current':    float(total_current) if not any_missing else None,
        'has_stale_prices': any_missing or any(h['price_stale'] for h in result),
        'fresh_invested':   fresh_invested,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def booked_pl(request):
    """Closed trades: ticker-level summary + individual trade detail."""
    from collections import defaultdict
    from decimal import Decimal

    trades = list(
        SIPTrade.objects.filter(user=request.user, exit_date__isnull=False)
        .order_by('-exit_date', '-trade_date')
    )

    if not trades:
        return Response({
            'summary': [], 'trades': [],
            'total_invested': 0, 'total_exit_value': 0,
            'total_pl': 0, 'total_return_pct': 0,
        })

    # ── Summary by ticker ──────────────────────────────────────────────────────
    by_ticker = defaultdict(lambda: {
        'etf_name': '', 'asset_class': '',
        'trade_count': 0, 'total_qty': Decimal('0'),
        'total_invested': Decimal('0'), 'total_exit_value': Decimal('0'),
    })
    for t in trades:
        h = by_ticker[t.ticker]
        h['etf_name']         = t.etf_name
        h['asset_class']      = t.asset_class
        h['trade_count']      += 1
        h['total_qty']        += t.qty
        h['total_invested']   += t.trade_value
        h['total_exit_value'] += (t.exit_value or Decimal('0'))

    # Override etf_name with canonical name from ETF master (covers old imported data)
    master_names = {
        e.ticker: e.etf_name
        for e in SIPETFMaster.objects.filter(ticker__in=list(by_ticker.keys()))
    }
    for ticker_key, h in by_ticker.items():
        if ticker_key in master_names:
            h['etf_name'] = master_names[ticker_key]

    summary = []
    for ticker, h in by_ticker.items():
        inv  = float(h['total_invested'])
        ext  = float(h['total_exit_value'])
        pl   = ext - inv
        ret  = (pl / inv * 100) if inv else 0
        summary.append({
            'ticker':           ticker,
            'etf_name':         h['etf_name'],
            'asset_class':      h['asset_class'],
            'trade_count':      h['trade_count'],
            'total_qty':        float(h['total_qty']),
            'total_invested':   round(inv, 2),
            'total_exit_value': round(ext, 2),
            'booked_pl':        round(pl,  2),
            'return_pct':       round(ret, 2),
        })
    summary.sort(key=lambda x: x['booked_pl'], reverse=True)

    # ── Trade-wise detail ──────────────────────────────────────────────────────
    trade_list = []
    for t in trades:
        inv = float(t.trade_value)
        ext = float(t.exit_value) if t.exit_value else None
        pl  = round(ext - inv, 2) if ext is not None else None
        ret = round((ext - inv) / inv * 100, 2) if ext and inv else None
        hold_days = (t.exit_date - t.trade_date).days if t.exit_date else None
        trade_list.append({
            'id':          str(t.id),
            'ticker':      t.ticker,
            'etf_name':    master_names.get(t.ticker, t.etf_name),
            'asset_class': t.asset_class,
            'trade_date':  t.trade_date.isoformat(),
            'exit_date':   t.exit_date.isoformat(),
            'hold_days':   hold_days,
            'qty':         float(t.qty),
            'buy_price':   float(t.price),
            'trade_value': round(inv, 2),
            'exit_price':  float(t.exit_price) if t.exit_price else None,
            'exit_value':  ext,
            'pl':          pl,
            'return_pct':  ret,
        })

    total_inv = sum(s['total_invested']   for s in summary)
    total_ext = sum(s['total_exit_value'] for s in summary)
    total_pl  = round(total_ext - total_inv, 2)
    total_ret = round(total_pl / total_inv * 100, 2) if total_inv else 0

    return Response({
        'summary':          summary,
        'trades':           trade_list,
        'total_invested':   round(total_inv, 2),
        'total_exit_value': round(total_ext, 2),
        'total_pl':         total_pl,
        'total_return_pct': total_ret,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sell(request):
    """
    FIFO sell across open positions for a ticker.
    Splits trades when only partially consumed.

    Body: { ticker, qty, exit_date (YYYY-MM-DD), exit_price }
    """
    ticker        = str(request.data.get('ticker', '')).strip().upper()
    exit_date_raw = str(request.data.get('exit_date', '')).strip()
    exit_price_raw = request.data.get('exit_price')
    sell_qty_raw   = request.data.get('qty')

    if not all([ticker, exit_date_raw, exit_price_raw is not None, sell_qty_raw is not None]):
        return Response({'error': 'ticker, qty, exit_date, exit_price are required'},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        exit_date  = datetime.strptime(exit_date_raw, '%Y-%m-%d').date()
        exit_price = Decimal(str(exit_price_raw))
        sell_qty   = Decimal(str(sell_qty_raw))
        if exit_price <= 0 or sell_qty <= 0:
            raise ValueError('must be positive')
    except Exception:
        return Response({'error': 'Invalid exit_date, exit_price, or qty'},
                        status=status.HTTP_400_BAD_REQUEST)

    # Open trades for this ticker, oldest first (FIFO)
    open_trades = list(
        SIPTrade.objects.filter(user=request.user, ticker=ticker, exit_date__isnull=True)
        .order_by('trade_date', 'created_at')
    )

    total_available = sum(t.qty for t in open_trades)
    if sell_qty > total_available:
        return Response(
            {'error': f'Not enough units. Available: {float(total_available):.4g}, requested: {float(sell_qty):.4g}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    D4 = Decimal('0.0001')
    remaining      = sell_qty
    n_closed       = 0
    n_splits       = 0

    with transaction.atomic():
        for trade in open_trades:
            if remaining <= 0:
                break

            if trade.qty <= remaining:
                # ── Full close ────────────────────────────────────────────────
                trade.exit_date  = exit_date
                trade.exit_price = exit_price
                trade.exit_value = (trade.qty * exit_price).quantize(D4)
                trade.save()
                remaining -= trade.qty
                n_closed  += 1

            else:
                # ── Partial close — split this trade ─────────────────────────
                sold_qty    = remaining
                leftover_qty = trade.qty - sold_qty

                # 1. Create the still-open remainder as a NEW row
                SIPTrade.objects.create(
                    user        = trade.user,
                    trade_date  = trade.trade_date,
                    etf_name    = trade.etf_name,
                    asset_class = trade.asset_class,
                    ticker      = trade.ticker,
                    qty         = leftover_qty,
                    price       = trade.price,
                    trade_value = (leftover_qty * trade.price).quantize(D4),
                    notes       = trade.notes,
                )

                # 2. Update original row to the sold portion only
                trade.qty        = sold_qty
                trade.trade_value = (sold_qty * trade.price).quantize(D4)
                trade.exit_date  = exit_date
                trade.exit_price = exit_price
                trade.exit_value = (sold_qty * exit_price).quantize(D4)
                trade.save()

                n_closed += 1
                n_splits += 1
                remaining = Decimal('0')

    return Response({
        'message':       f'Sold {float(sell_qty):.4g} units of {ticker} via FIFO',
        'trades_closed': n_closed,
        'splits_created': n_splits,
    })


def _is_admin(user) -> bool:
    return getattr(user, 'role', None) == 'ADMIN' or user.is_staff


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def etf_master_list(request):
    if request.method == 'GET':
        qs = SIPETFMaster.objects.filter(is_active=True)
        return Response([{'ticker': e.ticker, 'etf_name': e.etf_name, 'asset_class': e.asset_class} for e in qs])

    if not _is_admin(request.user):
        return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)

    ticker      = str(request.data.get('ticker', '')).strip().upper()
    etf_name    = str(request.data.get('etf_name', '')).strip()
    asset_class = str(request.data.get('asset_class', '')).strip()
    if not ticker or not etf_name or not asset_class:
        return Response({'error': 'ticker, etf_name, asset_class are required'}, status=status.HTTP_400_BAD_REQUEST)

    etf, created = SIPETFMaster.objects.update_or_create(
        ticker=ticker,
        defaults={'etf_name': etf_name, 'asset_class': asset_class, 'is_active': True},
    )
    return Response(
        {'ticker': etf.ticker, 'etf_name': etf.etf_name, 'asset_class': etf.asset_class},
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def etf_master_detail(request, ticker):
    if not _is_admin(request.user):
        return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)

    try:
        etf = SIPETFMaster.objects.get(ticker=ticker.upper())
    except SIPETFMaster.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        etf.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    etf.etf_name    = str(request.data.get('etf_name',    etf.etf_name)).strip()
    etf.asset_class = str(request.data.get('asset_class', etf.asset_class)).strip()
    etf.save()
    return Response({'ticker': etf.ticker, 'etf_name': etf.etf_name, 'asset_class': etf.asset_class})


def _trade_to_dict(t: SIPTrade) -> dict:
    return {
        'id':          str(t.id),
        'trade_date':  str(t.trade_date),
        'etf_name':    t.etf_name,
        'asset_class': t.asset_class,
        'ticker':      t.ticker,
        'qty':         float(t.qty),
        'price':       float(t.price),
        'trade_value': float(t.trade_value),
        'exit_date':   str(t.exit_date) if t.exit_date else None,
        'exit_price':  float(t.exit_price) if t.exit_price else None,
        'exit_value':  float(t.exit_value) if t.exit_value else None,
        'pl':          float(t.exit_value - t.trade_value) if t.exit_value else None,
        'notes':       t.notes,
    }
