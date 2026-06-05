from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db.models import Sum, Avg
from portfolio.models import Portfolio
from .models import Trade
from .serializers import TradeSerializer, CloseTradeSerializer
from .filters import TradeFilter
import csv, io
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

def get_portfolio(portfolio_id, user):
    if user.role == 'ADMIN' or user.is_staff:
        return get_object_or_404(Portfolio, id=portfolio_id)
    return get_object_or_404(Portfolio, id=portfolio_id, user=user)

class TradeListCreateView(generics.ListCreateAPIView):
    serializer_class   = TradeSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_class    = TradeFilter
    search_fields      = ['scrip_name']
    ordering_fields    = ['entry_date', 'net_income', 'scrip_name']

    def get_queryset(self):
        portfolio = get_portfolio(self.kwargs['portfolio_id'], self.request.user)
        return Trade.objects.filter(portfolio=portfolio)

    def perform_create(self, serializer):
        portfolio = get_portfolio(self.kwargs['portfolio_id'], self.request.user)
        serializer.save(portfolio=portfolio)

class TradeDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class   = TradeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        portfolio = get_portfolio(self.kwargs['portfolio_id'], self.request.user)
        return Trade.objects.filter(portfolio=portfolio)

@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def close_trade(request, portfolio_id, pk):
    portfolio = get_portfolio(portfolio_id, request.user)
    trade = get_object_or_404(Trade, id=pk, portfolio=portfolio)
    if trade.is_closed:
        return Response({'success': False, 'message': 'Trade already closed'}, status=400)
    serializer = CloseTradeSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({'success': False, 'message': serializer.errors}, status=400)
    trade.close_date  = serializer.validated_data['close_date']
    trade.close_price = serializer.validated_data['close_price']
    trade.save()
    return Response({'success': True, 'message': 'Trade closed',
                     'data': TradeSerializer(trade).data})

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def import_csv(request, portfolio_id):
    portfolio     = get_portfolio(portfolio_id, request.user)
    file          = request.FILES.get('file')
    mapping       = request.data
    mode          = mapping.get('mode', 'smart')        # smart | append_from_date | replace
    from_date_str = mapping.get('from_date', '').strip()

    if not file:
        return Response({'success': False, 'message': 'No file provided'}, status=400)

    from_date = None
    if from_date_str:
        try:
            from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response({'success': False, 'message': 'Invalid from_date — use YYYY-MM-DD'}, status=400)

    try:
        # replace: wipe portfolio trades before importing
        if mode == 'replace':
            Trade.objects.filter(portfolio=portfolio).delete()

        # Pre-fetch existing trades as a set of tuples for O(1) duplicate lookup.
        # Fetched AFTER any delete so replace mode starts with an empty set.
        existing_trades = set()
        if mode == 'smart':
            existing_trades = set(
                Trade.objects.filter(portfolio=portfolio)
                .values_list('scrip_name', 'entry_date', 'entry_price', 'quantity', 'direction')
            )

        decoded  = file.read().decode('utf-8')
        reader   = csv.DictReader(io.StringIO(decoded))
        trades_to_create             = []
        imported, skipped, duplicates, errors = 0, 0, 0, []

        DATE_FORMATS = ['%Y-%m-%d', '%d-%b-%Y', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y']

        def parse_date(s):
            for fmt in DATE_FORMATS:
                try:
                    return datetime.strptime(s.strip(), fmt).date()
                except ValueError:
                    continue
            raise ValueError(f"Cannot parse date: {s}")

        def parse_decimal(s):
            try:
                return Decimal(str(s).strip().replace(',', ''))
            except Exception:
                return None

        def get_val(row, field):
            col = mapping.get(field, '')
            return row.get(col, '').strip() if col else ''

        for i, row in enumerate(reader, 1):
            try:
                scrip = get_val(row, 'scripName')
                if not scrip:
                    skipped += 1
                    continue

                entry_date_str = get_val(row, 'entryDate')
                if not entry_date_str:
                    skipped += 1
                    continue

                entry_date  = parse_date(entry_date_str)
                entry_price = parse_decimal(get_val(row, 'entryPrice'))
                quantity    = parse_decimal(get_val(row, 'quantity'))

                # append_from_date: skip rows before the cutoff
                if mode == 'append_from_date' and from_date and entry_date < from_date:
                    skipped += 1
                    continue

                seg_raw   = get_val(row, 'segment') or 'EQUITY'
                seg_map   = {'equity': 'EQUITY', 'commodity': 'COMMODITY',
                             'f&o': 'F_AND_O', 'fno': 'F_AND_O', 'f_and_o': 'F_AND_O'}
                segment   = seg_map.get(seg_raw.lower(), 'EQUITY')
                dir_raw   = get_val(row, 'direction') or 'LONG'
                direction = 'SHORT' if dir_raw.strip().upper() == 'SHORT' else 'LONG'

                # smart: O(1) set lookup instead of a DB query per row
                if mode == 'smart':
                    key = (scrip, entry_date, entry_price, quantity, direction)
                    if key in existing_trades:
                        duplicates += 1
                        continue
                    existing_trades.add(key)   # catch within-CSV dupes too

                trade = Trade(
                    portfolio   = portfolio,
                    scrip_name  = scrip,
                    segment     = segment,
                    direction   = direction,
                    legs        = int(get_val(row, 'legs')) if get_val(row, 'legs') else None,
                    entry_date  = entry_date,
                    entry_price = entry_price,
                    quantity    = quantity,
                    stop_loss   = parse_decimal(get_val(row, 'stopLoss')) or None,
                    notes       = get_val(row, 'notes'),
                )

                close_date_str  = get_val(row, 'closeDate')
                close_price_str = get_val(row, 'closePrice')
                if close_date_str:
                    trade.close_date  = parse_date(close_date_str)
                if close_price_str:
                    trade.close_price = parse_decimal(close_price_str)

                # bulk_create skips save() and signals, so compute derived
                # fields (target, initial_risk, gross_pl, charges, net_income,
                # risk_reward) the same way save() would via recalculate().
                trade.recalculate()

                trades_to_create.append(trade)
                imported += 1

            except Exception as e:
                errors.append(f"Row {i}: {str(e)}")
                skipped += 1

        if trades_to_create:
            Trade.objects.bulk_create(trades_to_create, batch_size=100)

        return Response({'success': True, 'data': {
            'imported':   imported,
            'skipped':    skipped,
            'duplicates': duplicates,
            'errors':     errors,
        }})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=400)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def bulk_import_trades(request, portfolio_id):
    """
    Accepts pre-parsed trades as JSON, handles dedup/replace in bulk.
    Replaces the slow per-row create loop in the frontend.
    """
    portfolio     = get_portfolio(portfolio_id, request.user)
    trades_data   = request.data.get('trades', [])
    mode          = request.data.get('mode', 'smart')
    from_date_str = (request.data.get('from_date') or '').strip()

    from_date = None
    if from_date_str:
        try:
            from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response({'success': False, 'message': 'Invalid from_date — use YYYY-MM-DD'}, status=400)

    if mode == 'replace':
        Trade.objects.filter(portfolio=portfolio).delete()

    # One query → set of tuples for O(1) dedup — avoids N DB round-trips
    existing_trades = set()
    if mode == 'smart':
        existing_trades = set(
            Trade.objects.filter(portfolio=portfolio)
            .values_list('scrip_name', 'entry_date', 'entry_price', 'quantity', 'direction')
        )

    DATE_FORMATS = ['%Y-%m-%d', '%d-%b-%Y', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y']

    def parse_date(s):
        if not s:
            return None
        for fmt in DATE_FORMATS:
            try:
                return datetime.strptime(str(s).strip(), fmt).date()
            except ValueError:
                continue
        raise ValueError(f"Cannot parse date: {s}")

    def to_decimal(v):
        if v is None or str(v).strip() == '':
            return None
        try:
            return Decimal(str(v).strip().replace(',', ''))
        except Exception:
            return None

    SEG_MAP = {
        'EQUITY': 'EQUITY', 'COMMODITY': 'COMMODITY',
        'F_AND_O': 'F_AND_O', 'F&O': 'F_AND_O', 'FNO': 'F_AND_O',
    }

    trades_to_create             = []
    imported, skipped, duplicates, errors = 0, 0, 0, []

    for i, td in enumerate(trades_data, 1):
        try:
            scrip = (td.get('scrip_name') or '').strip()
            if not scrip:
                skipped += 1
                continue

            entry_date  = parse_date(td.get('entry_date'))
            entry_price = to_decimal(td.get('entry_price'))
            quantity    = to_decimal(td.get('quantity'))

            if not entry_date or entry_price is None or quantity is None:
                skipped += 1
                continue

            direction = 'SHORT' if str(td.get('direction', '')).upper() == 'SHORT' else 'LONG'

            if mode == 'append_from_date' and from_date and entry_date < from_date:
                skipped += 1
                continue

            if mode == 'smart':
                key = (scrip, entry_date, entry_price, quantity, direction)
                if key in existing_trades:
                    duplicates += 1
                    continue
                existing_trades.add(key)

            segment = SEG_MAP.get(str(td.get('segment', 'EQUITY')).upper(), 'EQUITY')
            legs_raw = td.get('legs')

            trade = Trade(
                portfolio   = portfolio,
                scrip_name  = scrip,
                segment     = segment,
                direction   = direction,
                legs        = int(legs_raw) if legs_raw else None,
                entry_date  = entry_date,
                entry_price = entry_price,
                quantity    = quantity,
                stop_loss   = to_decimal(td.get('stop_loss')) or None,
                notes       = td.get('notes') or '',
            )

            close_date  = parse_date(td.get('close_date'))
            close_price = to_decimal(td.get('close_price'))
            if close_date:
                trade.close_date  = close_date
            if close_price:
                trade.close_price = close_price

            # bulk_create skips save() — compute derived fields manually
            trade.recalculate()

            trades_to_create.append(trade)
            imported += 1

        except Exception as e:
            errors.append(f"Row {i} ({td.get('scrip_name', '?')}): {str(e)}")
            skipped += 1

    if trades_to_create:
        Trade.objects.bulk_create(trades_to_create, batch_size=500)

    return Response({'success': True, 'data': {
        'imported':   imported,
        'skipped':    skipped,
        'duplicates': duplicates,
        'errors':     errors,
    }})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def clear_trades(request, portfolio_id):
    """Delete all trades for a portfolio (used by replace-mode import)."""
    portfolio = get_portfolio(portfolio_id, request.user)
    deleted, _ = Trade.objects.filter(portfolio=portfolio).delete()
    return Response({'success': True, 'data': {'deleted': deleted}})

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def stats(request, portfolio_id):
    portfolio = get_portfolio(portfolio_id, request.user)
    segment   = request.query_params.get('segment')
    year      = request.query_params.get('year')
    month     = request.query_params.get('month')
    qs = Trade.objects.filter(portfolio=portfolio)
    if segment:
        seg_map = {'EQUITY':'EQUITY','COMMODITY':'COMMODITY',
                   'F&O':'F_AND_O','F_AND_O':'F_AND_O'}
        qs = qs.filter(segment=seg_map.get(segment.upper(), segment))
    all_qs    = qs
    closed_qs = qs.exclude(close_date__isnull=True,
                           close_price__isnull=True).filter(net_income__isnull=False)
    if year and month:
        closed_qs = closed_qs.filter(
            close_date__year=year, close_date__month=month)
    profit_qs  = closed_qs.filter(net_income__gt=0)
    loss_qs    = closed_qs.filter(net_income__lt=0)
    total_net  = closed_qs.aggregate(s=Sum('net_income'))['s'] or Decimal('0')
    total_pl   = closed_qs.aggregate(s=Sum('gross_pl'))['s'] or Decimal('0')
    avg_profit = profit_qs.aggregate(a=Avg('net_income'))['a'] or Decimal('0')
    avg_loss   = loss_qs.aggregate(a=Avg('net_income'))['a'] or Decimal('0')
    closed_cnt = closed_qs.count()
    open_cnt   = all_qs.filter(close_date__isnull=True,
                               close_price__isnull=True).count()
    win_rate      = round(profit_qs.count() / closed_cnt * 100, 2) if closed_cnt else 0
    avg_per_trade = round(total_net / closed_cnt, 2) if closed_cnt else Decimal('0')
    actual_rr     = round(abs(avg_profit / avg_loss), 4) if avg_loss else Decimal('0')
    denominator   = avg_profit - avg_loss
    breakeven     = round(abs(avg_loss) / abs(denominator) * 100, 2) if denominator else Decimal('0')
    current_capital = None
    if not segment:
        current_capital = (portfolio.starting_capital + total_net).quantize(
            Decimal('0.01'), ROUND_HALF_UP)
    return Response({'success': True, 'data': {
        'total_trades':       all_qs.count(),
        'closed_trades':      closed_cnt,
        'open_trades':        open_cnt,
        'trade_in_profit':    profit_qs.count(),
        'trade_in_loss':      loss_qs.count(),
        'total_net_income':   str(total_net),
        'total_gross_pl':     str(total_pl),
        'avg_profit':         str(avg_profit),
        'avg_loss':           str(avg_loss),
        'avg_per_trade':      str(avg_per_trade),
        'win_rate':           str(win_rate),
        'actual_rr':          str(actual_rr),
        'breakeven_accuracy': str(breakeven),
        'current_capital':    str(current_capital) if current_capital else None,
        'starting_capital':   str(portfolio.starting_capital),
        'worst_case_capital': str(portfolio.worst_case_capital),
    }})

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def equity_curve(request, portfolio_id):
    portfolio = get_portfolio(portfolio_id, request.user)
    segment   = request.query_params.get('segment')
    basis     = request.query_params.get('basis', 'net_income')
    year      = request.query_params.get('year')
    month     = request.query_params.get('month')
    qs = Trade.objects.filter(portfolio=portfolio).exclude(
        close_date__isnull=True, close_price__isnull=True
    ).filter(net_income__isnull=False)
    if segment:
        seg_map = {'EQUITY':'EQUITY','COMMODITY':'COMMODITY',
                   'F&O':'F_AND_O','F_AND_O':'F_AND_O'}
        qs = qs.filter(segment=seg_map.get(segment.upper(), segment))
    qs = qs.order_by('close_date', 'entry_date')
    running = portfolio.starting_capital
    points  = []
    for t in qs:
        val  = t.net_income if basis == 'net_income' else t.gross_pl
        if val is None:
            continue
        running += val
        date = str(t.close_date or t.entry_date)
        points.append({'date': date,
                       'capital': str(running.quantize(Decimal('0.01'), ROUND_HALF_UP))})
    if year and month:
        prefix = f"{year}-{int(month):02d}"
        # Capital level just before the selected month — curve will start relative to this
        pre_points  = [p for p in points if not p['date'].startswith(prefix)]
        base_capital = Decimal(pre_points[-1]['capital']) if pre_points else portfolio.starting_capital
        month_points = [p for p in points if p['date'].startswith(prefix)]
        # Return relative P&L so the curve starts at 0 for the selected period
        points = [
            {
                'date':    p['date'],
                'capital': str(
                    (Decimal(p['capital']) - base_capital).quantize(Decimal('0.01'), ROUND_HALF_UP)
                ),
            }
            for p in month_points
        ]
    return Response({'success': True, 'data': points})

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def monthly_pnl(request, portfolio_id):
    portfolio = get_portfolio(portfolio_id, request.user)
    segment   = request.query_params.get('segment')
    qs = Trade.objects.filter(portfolio=portfolio).exclude(
        close_date__isnull=True, close_price__isnull=True
    ).filter(net_income__isnull=False)
    if segment:
        seg_map = {'EQUITY':'EQUITY','COMMODITY':'COMMODITY',
                   'F&O':'F_AND_O','F_AND_O':'F_AND_O'}
        qs = qs.filter(segment=seg_map.get(segment.upper(), segment))
    monthly = {}
    for t in qs:
        d   = t.close_date or t.entry_date
        key = f"{d.year}-{d.month:02d}"
        monthly[key] = monthly.get(key, Decimal('0')) + t.net_income
    result = [{'month': k, 'net_income': str(v)}
              for k, v in sorted(monthly.items())]
    return Response({'success': True, 'data': result})

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def closed_months(request, portfolio_id):
    portfolio = get_portfolio(portfolio_id, request.user)
    qs = Trade.objects.filter(portfolio=portfolio).exclude(
        close_date__isnull=True, close_price__isnull=True)
    months = set()
    for t in qs:
        d = t.close_date or t.entry_date
        months.add(f"{d.year}-{d.month:02d}")
    return Response({'success': True, 'data': sorted(months)})