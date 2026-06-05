from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from django.db import transaction as db_transaction
from decimal import Decimal

from .models import MFFolio, MFScheme, MFTransaction
from .parser import parse_cas_pdf


# ── CAS Import ────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def import_cas(request):
    pdf_file = request.FILES.get('file')
    if not pdf_file:
        return Response({'success': False, 'message': 'No PDF file provided'}, status=400)

    if not pdf_file.name.lower().endswith('.pdf'):
        return Response({'success': False, 'message': 'Only PDF files are accepted'}, status=400)

    try:
        parsed = parse_cas_pdf(pdf_file)
    except Exception as e:
        return Response({'success': False, 'message': f'Parse error: {str(e)}'}, status=400)

    imported_folios = 0
    imported_schemes = 0
    imported_txns = 0
    skipped_txns = 0

    try:
        with db_transaction.atomic():
            for folio_data in parsed.get('folios', []):
                folio_obj, _ = MFFolio.objects.update_or_create(
                    user=request.user,
                    folio_number=folio_data['folio_number'],
                    defaults={
                        'fund_house':  folio_data.get('fund_house', ''),
                        'holder_name': folio_data.get('holder_name', ''),
                        'pan':         folio_data.get('pan', ''),
                    },
                )
                imported_folios += 1

                for scheme_data in folio_data.get('schemes', []):
                    scheme_name = scheme_data.get('scheme_name', '').strip()
                    isin        = scheme_data.get('isin', '').strip()
                    if not scheme_name:
                        continue

                    lookup = {'folio': folio_obj}
                    if isin:
                        lookup['isin'] = isin
                    else:
                        lookup['scheme_name'] = scheme_name

                    scheme_defaults = {
                        'scheme_name':      scheme_name,
                        'scheme_code':      scheme_data.get('scheme_code', ''),
                        'isin':             isin,
                        'registrar':        scheme_data.get('registrar', ''),
                        'plan':             scheme_data.get('plan', 'DIRECT'),
                        'option':           scheme_data.get('option', 'GROWTH'),
                        'closing_units':    scheme_data.get('closing_units'),
                        'closing_nav':      scheme_data.get('closing_nav'),
                        'closing_nav_date': scheme_data.get('closing_nav_date'),
                        'cost_value':       scheme_data.get('cost_value'),
                        'market_value':     scheme_data.get('market_value'),
                    }

                    scheme_obj, _ = MFScheme.objects.update_or_create(
                        **lookup, defaults=scheme_defaults,
                    )
                    imported_schemes += 1

                    for txn in scheme_data.get('transactions', []):
                        _, created = MFTransaction.objects.get_or_create(
                            scheme           = scheme_obj,
                            transaction_date = txn['date'],
                            amount           = txn['amount'],
                            units            = txn['units'],
                            defaults={
                                'transaction_type': txn['txn_type'],
                                'description':      txn['description'],
                                'nav':              txn['nav'],
                                'unit_balance':     txn['unit_balance'],
                            },
                        )
                        if created:
                            imported_txns += 1
                        else:
                            skipped_txns += 1

    except Exception as e:
        return Response({'success': False, 'message': f'Database error: {str(e)}'}, status=500)

    return Response({'success': True, 'data': {
        'folios':   imported_folios,
        'schemes':  imported_schemes,
        'imported': imported_txns,
        'skipped':  skipped_txns,
        'investor': parsed.get('investor', {}),
    }})


# ── Dashboard ─────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard(request):
    folios   = MFFolio.objects.filter(user=request.user).prefetch_related('schemes')
    schemes  = MFScheme.objects.filter(folio__user=request.user)

    total_cost   = sum(s.cost_value   or 0 for s in schemes)
    total_market = sum(s.market_value or 0 for s in schemes)
    gain_loss    = total_market - total_cost
    gain_pct     = float(gain_loss / total_cost * 100) if total_cost else 0

    # Fund-house level summary
    fh_map = {}
    for s in schemes:
        fh = s.folio.fund_house
        if fh not in fh_map:
            fh_map[fh] = {'fund_house': fh, 'cost_value': Decimal('0'), 'market_value': Decimal('0'), 'schemes': 0}
        fh_map[fh]['cost_value']   += s.cost_value   or 0
        fh_map[fh]['market_value'] += s.market_value or 0
        fh_map[fh]['schemes']      += 1

    fund_houses = [
        {
            'fund_house':   v['fund_house'],
            'cost_value':   str(v['cost_value']),
            'market_value': str(v['market_value']),
            'gain_loss':    str(v['market_value'] - v['cost_value']),
            'schemes':      v['schemes'],
        }
        for v in sorted(fh_map.values(), key=lambda x: x['market_value'], reverse=True)
    ]

    return Response({'success': True, 'data': {
        'total_cost_value':   str(total_cost),
        'total_market_value': str(total_market),
        'total_gain_loss':    str(gain_loss),
        'gain_loss_pct':      round(gain_pct, 2),
        'total_folios':       folios.count(),
        'total_schemes':      schemes.count(),
        'fund_houses':        fund_houses,
    }})


# ── Schemes list ──────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def schemes_list(request):
    fund_house = request.query_params.get('fund_house')
    qs = MFScheme.objects.filter(folio__user=request.user).select_related('folio')
    if fund_house:
        qs = qs.filter(folio__fund_house__icontains=fund_house)

    data = []
    for s in qs:
        gl  = (s.market_value or 0) - (s.cost_value or 0)
        pct = float(gl / s.cost_value * 100) if s.cost_value else 0
        data.append({
            'id':               s.id,
            'folio_number':     s.folio.folio_number,
            'fund_house':       s.folio.fund_house,
            'scheme_name':      s.scheme_name,
            'scheme_code':      s.scheme_code,
            'isin':             s.isin,
            'plan':             s.plan,
            'option':           s.option,
            'registrar':        s.registrar,
            'closing_units':    str(s.closing_units or ''),
            'closing_nav':      str(s.closing_nav   or ''),
            'closing_nav_date': str(s.closing_nav_date or ''),
            'cost_value':       str(s.cost_value    or ''),
            'market_value':     str(s.market_value  or ''),
            'gain_loss':        str(gl),
            'gain_loss_pct':    round(pct, 2),
        })

    return Response({'success': True, 'data': data})


# ── Transactions list ─────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def transactions_list(request):
    scheme_id  = request.query_params.get('scheme_id')
    fund_house = request.query_params.get('fund_house')
    txn_type   = request.query_params.get('txn_type')

    qs = MFTransaction.objects.filter(
        scheme__folio__user=request.user
    ).select_related('scheme__folio').order_by('-transaction_date')

    if scheme_id:
        qs = qs.filter(scheme_id=scheme_id)
    if fund_house:
        qs = qs.filter(scheme__folio__fund_house__icontains=fund_house)
    if txn_type:
        qs = qs.filter(transaction_type=txn_type)

    data = [{
        'id':               t.id,
        'scheme_id':        t.scheme_id,
        'scheme_name':      t.scheme.scheme_name,
        'fund_house':       t.scheme.folio.fund_house,
        'folio_number':     t.scheme.folio.folio_number,
        'transaction_date': str(t.transaction_date),
        'transaction_type': t.transaction_type,
        'description':      t.description,
        'amount':           str(t.amount),
        'units':            str(t.units),
        'nav':              str(t.nav),
        'unit_balance':     str(t.unit_balance),
    } for t in qs]

    return Response({'success': True, 'data': data})


# ── Delete all MF data ────────────────────────────────────────────────────────

@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_all(request):
    deleted, _ = MFFolio.objects.filter(user=request.user).delete()
    return Response({'success': True, 'data': {'deleted_folios': deleted}})
