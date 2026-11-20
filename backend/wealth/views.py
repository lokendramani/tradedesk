import logging
import json
from collections.abc import Mapping
from uuid import UUID, uuid4
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.db.models import DecimalField, OuterRef, Subquery, Sum
from django.db.models.functions import Lower, Trim
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from rest_framework.utils.urls import replace_query_param

from users.permissions import HasWealthAccess
from .models import (
    CashFlowCategory, CashFlowEntry, CashFlowProfile, MutualFundScheme,
    WealthFundHouse, WealthFolio, WealthInstrument, WealthMFTransactionDetail,
    WealthMFNAVHistory, WealthMilestone, WealthTransaction, WealthTransactionAudit,
    WealthSIPInstallment, WealthSIPMandate,
)
from .holdings import wealth_moving_average_positions, wealth_unit_delta_expression
from .sip import calculate_sip_purchase_values, generate_due_installments, generate_for_active_mandates
from .nav_updates import (
    NAVUpdateBusy, NAVUpdateError, ensure_scheme_history_loaded,
    latest_nav_update_summary, run_amfi_nav_update,
)
from .scheme_catalogue import (
    CatalogueError, catalogue_is_populated, initialize_scheme_catalogue, refresh_scheme_catalogue,
)
from .serializers import (
    CashFlowCategorySerializer, CashFlowEntrySerializer, MutualFundSchemeSerializer,
    WealthFundHouseSerializer, WealthFolioSerializer, WealthInstrumentSerializer,
    WealthMilestoneSerializer, WealthTransactionAuditSerializer,
    WealthSwitchPairSerializer, WealthTransactionSerializer,
    WealthSIPConfirmSerializer, WealthSIPInstallmentSerializer, WealthSIPMandateSerializer,
    wealth_folio_delete_block_reason, wealth_sip_mandate_delete_block_reason,
)


logger = logging.getLogger(__name__)
# Django's built-in development-server logger writes to the runserver console.
switch_edit_logger = logging.getLogger('django.server')


def _folio_input_diagnostic(raw_leg, field):
    present = isinstance(raw_leg, Mapping) and field in raw_leg
    value = raw_leg.get(field) if isinstance(raw_leg, Mapping) else None
    if value is None:
        classification = 'null' if present else 'missing'
    elif isinstance(value, bool):
        classification = 'other'
    elif isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        classification = 'display_number'
    elif isinstance(value, str):
        try:
            UUID(value)
            classification = 'uuid_like'
        except (ValueError, AttributeError):
            classification = 'other'
    else:
        classification = 'other'
    return {
        'folio_present': present,
        'raw_folio': value,
        'python_type': type(value).__name__ if present else None,
        'folio_classification': classification,
    }


def _switch_edit_diagnostic_legs(raw_data):
    legs = raw_data if isinstance(raw_data, Mapping) else {}
    return {
        key: _folio_input_diagnostic(legs.get(key), 'folio')
        for key in ('switch_out', 'switch_in')
    }


def _log_switch_edit_validation(switch_group_id, stage, raw_legs, errors=None, validated_legs=None):
    if errors:
        switch_edit_logger.warning('switch_edit_validation_failed %s', json.dumps({
            'switch_group_uuid': str(switch_group_id),
            'stage': stage,
            'validation': 'failed',
            'legs': raw_legs,
            'serializer_errors': errors,
        }, default=str, sort_keys=True))
        return

    legs = {}
    for key in ('switch_out', 'switch_in'):
        validated = (validated_legs or {}).get(key, {})
        folio = validated.get('folio')
        legs[key] = {
            **raw_legs.get(key, {}),
            'validation': 'passed',
            'resolved_folio_uuid': str(folio.pk) if folio else None,
            'ownership_check': 'passed' if folio else 'not_applicable',
            'amc_check': 'passed',
        }
    switch_edit_logger.info('switch_edit_validation_succeeded %s', json.dumps({
        'switch_group_uuid': str(switch_group_id),
        'stage': stage,
        'validation': 'passed',
        'legs': legs,
    }, default=str, sort_keys=True))


def _profile_payload(user):
    profile, _ = CashFlowProfile.objects.get_or_create(user=user)
    categories = CashFlowCategory.objects.filter(user=user)
    entries = CashFlowEntry.objects.filter(profile=profile).select_related('category')
    totals = profile.calculate_totals()
    expense_breakdown = list(
        CashFlowEntry.objects.filter(
            profile=profile,
            category__section=CashFlowCategory.Section.EXPENSES,
        )
        .values('category_id', 'category__name')
        .order_by('category__name')
        .annotate(amount=Sum('amount'))
    )
    return {
        'profile_id': profile.pk,
        'categories': CashFlowCategorySerializer(categories, many=True).data,
        'entries': CashFlowEntrySerializer(entries, many=True).data,
        'totals': {key: f'{value:.2f}' for key, value in totals.items()},
        'expense_breakdown': [
            {'category_id': row['category_id'], 'category_name': row['category__name'], 'amount': f"{row['amount']:.2f}"}
            for row in expense_breakdown
        ],
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def cash_flow_profile(request):
    return Response(_profile_payload(request.user))


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def cash_flow_categories(request):
    if request.method == 'GET':
        categories = CashFlowCategory.objects.filter(user=request.user)
        return Response(CashFlowCategorySerializer(categories, many=True).data)

    serializer = CashFlowCategorySerializer(
        data=request.data,
        context={'request': request, 'handle_category_name_conflicts': True},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    section = serializer.validated_data['section']
    name = serializer.validated_data['name']
    with transaction.atomic():
        # Serializes category writes for this user; the database constraint below
        # remains the final guard for concurrent requests from other processes.
        type(request.user).objects.select_for_update().get(pk=request.user.pk)
        matching_categories = CashFlowCategory.objects.filter(
            user=request.user,
            section=section,
        ).annotate(normalized_name=Lower(Trim('name'))).filter(normalized_name=name.lower())
        active = matching_categories.filter(is_archived=False).first()
        if active:
            return Response({'name': ['This category already exists.']}, status=400)
        archived = matching_categories.filter(is_archived=True).order_by('id').first()
        if archived:
            archived.is_archived = False
            try:
                with transaction.atomic():
                    archived.save(update_fields=['is_archived', 'updated_at'])
            except IntegrityError:
                return Response({'name': ['This category already exists.']}, status=400)
            category = archived
            response_status = status.HTTP_200_OK
        else:
            try:
                with transaction.atomic():
                    category = serializer.save(user=request.user)
            except IntegrityError:
                return Response({'name': ['This category already exists.']}, status=400)
            response_status = status.HTTP_201_CREATED
    return Response(CashFlowCategorySerializer(category).data, status=response_status)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def cash_flow_category_detail(request, pk):
    category = get_object_or_404(CashFlowCategory, pk=pk, user=request.user)
    if request.method == 'DELETE':
        if not category.is_archived:
            category.is_archived = True
            category.save(update_fields=['is_archived', 'updated_at'])
        return Response(CashFlowCategorySerializer(category).data)

    serializer = CashFlowCategorySerializer(category, data=request.data, partial=True, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    try:
        with transaction.atomic():
            type(request.user).objects.select_for_update().get(pk=request.user.pk)
            # Recheck after acquiring the per-user write lock to close the race
            # between serializer validation and a simultaneous category write.
            name = serializer.validated_data.get('name', category.name)
            is_archived = serializer.validated_data.get('is_archived', category.is_archived)
            if not is_archived:
                duplicate = CashFlowCategory.objects.filter(
                    user=request.user,
                    section=category.section,
                    is_archived=False,
                ).annotate(normalized_name=Lower(Trim('name'))).filter(normalized_name=name.lower()).exclude(pk=category.pk).exists()
                if duplicate:
                    return Response({'name': ['This category already exists.']}, status=400)
            category = serializer.save()
    except IntegrityError:
        return Response({'name': ['This category already exists.']}, status=400)
    return Response(CashFlowCategorySerializer(category).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def cash_flow_entries(request):
    profile, _ = CashFlowProfile.objects.get_or_create(user=request.user)
    if request.method == 'GET':
        entries = CashFlowEntry.objects.filter(profile=profile).select_related('category')
        return Response(CashFlowEntrySerializer(entries, many=True).data)

    serializer = CashFlowEntrySerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    entry = serializer.save(profile=profile)
    return Response(CashFlowEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def cash_flow_entry_detail(request, pk):
    entry = get_object_or_404(
        CashFlowEntry.objects.select_related('category'),
        pk=pk,
        profile__user=request.user,
    )
    if request.method == 'DELETE':
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = CashFlowEntrySerializer(
        entry, data=request.data, partial=True, context={'request': request}
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    entry = serializer.save()
    return Response(CashFlowEntrySerializer(entry).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_milestones(request):
    if request.method == 'GET':
        milestones = WealthMilestone.objects.filter(user=request.user)
        return Response({
            'current_year': timezone.localdate().year,
            'milestones': WealthMilestoneSerializer(milestones, many=True).data,
        })

    serializer = WealthMilestoneSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    milestone = serializer.save(user=request.user)
    return Response(WealthMilestoneSerializer(milestone).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_milestone_detail(request, pk):
    milestone = get_object_or_404(WealthMilestone, pk=pk, user=request.user)
    if request.method == 'DELETE':
        milestone.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = WealthMilestoneSerializer(milestone, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    milestone = serializer.save()
    return Response(WealthMilestoneSerializer(milestone).data)


class SchemeCataloguePagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 200

    def _page_link(self, page_number):
        url = self.request.build_absolute_uri()
        url = replace_query_param(url, self.page_query_param, page_number)
        if self.page_size_query_param:
            url = replace_query_param(url, self.page_size_query_param, self.page.paginator.per_page)
        return url

    def get_next_link(self):
        if not self.page.has_next():
            return None
        return self._page_link(self.page.next_page_number())

    def get_previous_link(self):
        if not self.page.has_previous():
            return None
        return self._page_link(self.page.previous_page_number())


def _initialize_scheme_catalogue_if_empty():
    try:
        if catalogue_is_populated():
            return None
        initialize_scheme_catalogue()
    except CatalogueError:
        return Response(
            {'detail': 'The scheme catalogue could not be initialized. Please retry.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def scheme_catalogue_filters(request):
    unavailable = _initialize_scheme_catalogue_if_empty()
    if unavailable:
        return unavailable
    schemes = MutualFundScheme.objects.all()
    return Response({
        'fund_houses': list(schemes.order_by().values_list('fund_house', flat=True).distinct().exclude(fund_house='').order_by('fund_house')),
        'categories': list(schemes.order_by().values_list('category_name', flat=True).distinct().exclude(category_name='').order_by('category_name')),
        'asset_classes': [{'value': value, 'label': label} for value, label in MutualFundScheme.AssetClass.choices],
        'plan_types': [{'value': value, 'label': label} for value, label in MutualFundScheme.PlanType.choices],
        'option_types': [{'value': value, 'label': label} for value, label in MutualFundScheme.OptionType.choices],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def scheme_catalogue(request):
    from django.db.models import Q

    queryset = MutualFundScheme.objects.all()
    search = request.query_params.get('search', '').strip()
    if search:
        # Match every search word across the catalog's user-facing variant
        # fields. AND across words lets searches such as "Direct Growth"
        # match plan_type=DIRECT and option_type=GROWTH.
        for term in search.split():
            queryset = queryset.filter(
                Q(scheme_name__icontains=term)
                | Q(scheme_code__icontains=term)
                | Q(fund_house__icontains=term)
                | Q(plan_type__icontains=term)
                | Q(option_type__icontains=term)
            )

    filters = {
        'fund_house': ('fund_house', None),
        'category': ('category_name', None),
        'asset_class': ('asset_class', MutualFundScheme.AssetClass.values),
        'plan_type': ('plan_type', MutualFundScheme.PlanType.values),
        'option_type': ('option_type', MutualFundScheme.OptionType.values),
    }
    for param, (field, choices) in filters.items():
        value = request.query_params.get(param, '').strip()
        if not value:
            continue
        if choices is not None and value not in choices:
            return Response({param: ['Invalid filter value.']}, status=status.HTTP_400_BAD_REQUEST)
        queryset = queryset.filter(**{field: value})

    unavailable = _initialize_scheme_catalogue_if_empty()
    if unavailable:
        return unavailable

    paginator = SchemeCataloguePagination()
    page = paginator.paginate_queryset(queryset, request)
    return paginator.get_paginated_response(MutualFundSchemeSerializer(page, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def scheme_catalogue_detail(request, scheme_code):
    unavailable = _initialize_scheme_catalogue_if_empty()
    if unavailable:
        return unavailable
    scheme = get_object_or_404(MutualFundScheme, scheme_code=scheme_code)
    return Response(MutualFundSchemeSerializer(scheme).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def scheme_catalogue_refresh(request):
    user = request.user
    if getattr(user, 'role', None) != 'ADMIN' and not getattr(user, 'is_staff', False):
        return Response({'detail': 'Administrator permission is required.'}, status=status.HTTP_403_FORBIDDEN)
    if 'source_url' in request.data or 'url' in request.data or 'file' in request.data:
        return Response({'detail': 'The catalogue source cannot be overridden.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        result = refresh_scheme_catalogue()
    except CatalogueError:
        return Response(
            {'detail': 'The scheme catalogue refresh failed. Please retry.'},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response(result)


def _is_wealth_admin(user):
    return getattr(user, 'role', None) == 'ADMIN' or getattr(user, 'is_staff', False)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_nav_update_admin(request):
    if not _is_wealth_admin(request.user):
        return Response({'detail': 'Administrator permission is required.'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'GET':
        return Response(latest_nav_update_summary())
    try:
        result = run_amfi_nav_update(triggered_by=request.user)
    except NAVUpdateBusy as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_409_CONFLICT)
    except Exception:
        logger.exception('AMFI NAV update POST trigger failed (trigger=ADMIN_MANUAL)')
        return Response(
            {'detail': 'The AMFI NAV update could not be started. Please retry.'},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    response_status = status.HTTP_502_BAD_GATEWAY if result['status'] == 'FAILED' else status.HTTP_200_OK
    return Response(result, status=response_status)


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_scheme_nav_history(request, scheme_code):
    scheme = get_object_or_404(MutualFundScheme, scheme_code=scheme_code)
    filters = {}
    for parameter, field in (('from', 'nav_date__gte'), ('to', 'nav_date__lte')):
        raw_value = request.query_params.get(parameter)
        if raw_value is None:
            continue
        try:
            parsed = date.fromisoformat(raw_value)
        except (TypeError, ValueError):
            return Response({parameter: ['Use YYYY-MM-DD format.']}, status=status.HTTP_400_BAD_REQUEST)
        if parsed.isoformat() != raw_value:
            return Response({parameter: ['Use YYYY-MM-DD format.']}, status=status.HTTP_400_BAD_REQUEST)
        filters[field] = parsed
    if filters.get('nav_date__gte') and filters.get('nav_date__lte') and filters['nav_date__gte'] > filters['nav_date__lte']:
        return Response({'detail': 'The from date must be on or before the to date.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        ensure_scheme_history_loaded(scheme)
    except NAVUpdateError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    records = WealthMFNAVHistory.objects.filter(scheme=scheme, **filters).order_by('nav_date')
    return Response({
        'scheme_code': scheme.scheme_code,
        'scheme_name': scheme.scheme_name,
        'results': [
            {'nav_date': row.nav_date.isoformat(), 'nav': f'{row.nav:.4f}'}
            for row in records
        ],
    })


def _wealth_transaction_snapshot(instance):
    detail = instance.mf_detail
    return {
        'id': str(instance.pk),
        'user_id': str(instance.user_id),
        'transaction_type': instance.transaction_type,
        'transaction_date': instance.transaction_date.isoformat(),
        'scheme_code': instance.instrument.scheme.scheme_code,
        'scheme_name': instance.instrument.scheme.scheme_name,
        'plan_type': instance.instrument.scheme.plan_type,
        'option_type': instance.instrument.scheme.option_type,
        'folio_id': str(instance.folio_id) if instance.folio_id else None,
        'source': instance.source,
        'source_reference': instance.source_reference,
        'switch_group_id': str(instance.switch_group_id) if instance.switch_group_id else None,
        'notes': instance.notes,
        'mf_detail': {
            'units': str(detail.units),
            'nav': str(detail.nav),
            'amount': str(detail.amount),
            'charges': str(detail.charges),
            'cashflow': str(detail.cashflow),
            'charges_source': detail.charges_source,
            'charges_breakdown': detail.charges_breakdown,
        },
    }


def _create_switch_leg(user, validated_data, transaction_type, switch_group_id):
    values = dict(validated_data)
    scheme_code = values.pop('scheme_code')
    detail_data = values.pop('mf_detail')
    scheme = MutualFundScheme.objects.get(scheme_code=scheme_code)
    instrument, _ = WealthInstrument.objects.get_or_create(
        scheme=scheme,
        defaults={'instrument_type': WealthInstrument.InstrumentType.MUTUAL_FUND},
    )
    instance = WealthTransaction.objects.create(
        user=user,
        instrument=instrument,
        transaction_type=transaction_type,
        switch_group_id=switch_group_id,
        **{key: value for key, value in values.items() if key != 'transaction_type'},
    )
    WealthMFTransactionDetail.objects.create(transaction=instance, **detail_data)
    return instance


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_fund_houses(request):
    houses = WealthFundHouse.objects.all()
    return Response(WealthFundHouseSerializer(houses, many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_folios(request):
    if request.method == 'GET':
        folios = WealthFolio.objects.filter(user=request.user).select_related('fund_house')
        return Response(WealthFolioSerializer(folios, many=True, context={'request': request}).data)
    serializer = WealthFolioSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    folio = serializer.save(user=request.user)
    return Response(WealthFolioSerializer(folio, context={'request': request}).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_folio_detail(request, folio_id):
    if request.method == 'DELETE':
        try:
            with transaction.atomic():
                folio = get_object_or_404(
                    WealthFolio.objects.select_for_update(of=('self',)),
                    pk=folio_id, user=request.user,
                )
                reason = wealth_folio_delete_block_reason(folio)
                if reason:
                    return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)
                folio.delete()
        except ProtectedError:
            return Response(
                {'detail': 'This folio became linked to a transaction or SIP mandate and cannot be deleted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    folio = get_object_or_404(
        WealthFolio.objects.select_related('fund_house'),
        pk=folio_id,
        user=request.user,
    )
    serializer = WealthFolioSerializer(
        folio, data=request.data, partial=True, context={'request': request},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    folio = serializer.save()
    return Response(WealthFolioSerializer(folio, context={'request': request}).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_instruments(request):
    if request.method == 'GET':
        instruments = WealthInstrument.objects.filter(
            instrument_type=WealthInstrument.InstrumentType.MUTUAL_FUND,
            scheme__isnull=False,
        ).select_related('scheme')
        return Response(WealthInstrumentSerializer(instruments, many=True).data)

    scheme_code = str(request.data.get('scheme_code', '')).strip()
    if not scheme_code:
        return Response({'scheme_code': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST)
    scheme = get_object_or_404(MutualFundScheme, scheme_code=scheme_code)
    instrument, created = WealthInstrument.objects.get_or_create(
        scheme=scheme,
        defaults={'instrument_type': WealthInstrument.InstrumentType.MUTUAL_FUND},
    )
    return Response(
        WealthInstrumentSerializer(instrument).data,
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_transactions(request):
    if request.method == 'GET':
        transactions = WealthTransaction.objects.filter(user=request.user).select_related(
            'instrument__scheme', 'folio', 'mf_detail',
        )
        folio_id = request.query_params.get('folio')
        if folio_id:
            get_object_or_404(WealthFolio, pk=folio_id, user=request.user)
            transactions = transactions.filter(folio_id=folio_id)
        scheme_code = request.query_params.get('scheme_code', '').strip()
        if scheme_code:
            transactions = transactions.filter(instrument__scheme__scheme_code=scheme_code)
        return Response(WealthTransactionSerializer(transactions, many=True, context={'request': request}).data)

    serializer = WealthTransactionSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        instance = serializer.save(user=request.user)
        snapshot = _wealth_transaction_snapshot(instance)
        WealthTransactionAudit.objects.create(
            transaction=instance,
            transaction_id_snapshot=instance.pk,
            owner=request.user,
            actor=request.user,
            action=WealthTransactionAudit.Action.CREATED,
            after=snapshot,
        )
    return Response(
        WealthTransactionSerializer(instance, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_transaction_detail(request, transaction_id):
    instance = get_object_or_404(
        WealthTransaction.objects.select_related('instrument__scheme', 'folio', 'mf_detail'),
        pk=transaction_id,
        user=request.user,
    )
    before = _wealth_transaction_snapshot(instance)
    if request.method == 'DELETE':
        if instance.transaction_type in {
            WealthTransaction.TransactionType.SWITCH_OUT,
            WealthTransaction.TransactionType.SWITCH_IN,
        }:
            return Response(
                {'detail': 'Switch legs cannot be deleted individually.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            installment = WealthSIPInstallment.objects.select_for_update(of=('self',)).filter(
                transaction=instance,
            ).first()
            WealthTransactionAudit.objects.create(
                transaction=instance,
                transaction_id_snapshot=instance.pk,
                owner=request.user,
                actor=request.user,
                action=WealthTransactionAudit.Action.DELETED,
                before=before,
            )
            if installment:
                installment.status = WealthSIPInstallment.Status.PENDING
                installment.transaction = None
                # Keep the prior transaction id as a pointer to its preserved audit snapshot.
                installment.save(update_fields=['status', 'transaction', 'updated_at'])
            instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = WealthTransactionSerializer(
        instance, data=request.data, partial=True, context={'request': request},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        instance = serializer.save()
        after = _wealth_transaction_snapshot(instance)
        WealthTransactionAudit.objects.create(
            transaction=instance,
            transaction_id_snapshot=instance.pk,
            owner=request.user,
            actor=request.user,
            action=WealthTransactionAudit.Action.UPDATED,
            before=before,
            after=after,
        )
    return Response(WealthTransactionSerializer(instance, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_switch_pair(request):
    serializer = WealthSwitchPairSerializer(
        data=request.data,
        context={'request': request, 'allow_switch_pair': True},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    switch_group_id = uuid4()
    with transaction.atomic():
        switch_out = _create_switch_leg(
            request.user, serializer.validated_data['switch_out'],
            WealthTransaction.TransactionType.SWITCH_OUT, switch_group_id,
        )
        switch_in = _create_switch_leg(
            request.user, serializer.validated_data['switch_in'],
            WealthTransaction.TransactionType.SWITCH_IN, switch_group_id,
        )
        for instance in (switch_out, switch_in):
            WealthTransactionAudit.objects.create(
                transaction=instance,
                transaction_id_snapshot=instance.pk,
                owner=request.user,
                actor=request.user,
                action=WealthTransactionAudit.Action.CREATED,
                after=_wealth_transaction_snapshot(instance),
            )
    return Response({
        'switch_group_id': str(switch_group_id),
        'switch_out': WealthTransactionSerializer(switch_out, context={'request': request}).data,
        'switch_in': WealthTransactionSerializer(switch_in, context={'request': request}).data,
    }, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_switch_group_detail(request, switch_group_id):
    legs = list(WealthTransaction.objects.filter(
        user=request.user, switch_group_id=switch_group_id,
    ).select_related('instrument__scheme', 'folio', 'mf_detail').order_by('transaction_type'))
    if len(legs) != 2 or {leg.transaction_type for leg in legs} != {
        WealthTransaction.TransactionType.SWITCH_OUT, WealthTransaction.TransactionType.SWITCH_IN,
    }:
        return Response({'detail': 'Switch pair not found.'}, status=status.HTTP_404_NOT_FOUND)
    by_type = {leg.transaction_type: leg for leg in legs}
    if request.method == 'DELETE':
        with transaction.atomic():
            locked_legs = list(WealthTransaction.objects.select_for_update(of=('self',)).filter(
                user=request.user, switch_group_id=switch_group_id,
            ).order_by('pk'))
            if len(locked_legs) != 2:
                return Response({'detail': 'Switch pair changed; reload and retry.'}, status=status.HTTP_409_CONFLICT)
            for leg in locked_legs:
                WealthTransactionAudit.objects.create(
                    transaction=leg, transaction_id_snapshot=leg.pk, owner=request.user,
                    actor=request.user, action=WealthTransactionAudit.Action.DELETED,
                    before=_wealth_transaction_snapshot(leg),
                )
            WealthTransaction.objects.filter(pk__in=[leg.pk for leg in locked_legs], user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    raw_folio_legs = _switch_edit_diagnostic_legs(request.data)
    try:
        serializer = WealthSwitchPairSerializer(
            data=request.data, context={'request': request, 'allow_switch_pair': True},
        )
        if not serializer.is_valid():
            _log_switch_edit_validation(
                switch_group_id, 'paired_serializer', raw_folio_legs, errors=serializer.errors,
            )
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        _log_switch_edit_validation(
            switch_group_id, 'paired_serializer', raw_folio_legs,
            validated_legs=serializer.validated_data,
        )
    except Exception:
        switch_edit_logger.exception('switch_edit_validation_exception %s', json.dumps({
            'switch_group_uuid': str(switch_group_id),
            'stage': 'paired_serializer',
            'legs': raw_folio_legs,
        }, default=str, sort_keys=True))
        raise
    with transaction.atomic():
        locked_legs = list(WealthTransaction.objects.select_for_update(of=('self',)).filter(
            user=request.user, switch_group_id=switch_group_id,
        ).order_by('pk'))
        locked_by_type = {leg.transaction_type: leg for leg in locked_legs}
        if len(locked_legs) != 2 or set(locked_by_type) != set(by_type):
            return Response({'detail': 'Switch pair changed; reload and retry.'}, status=status.HTTP_409_CONFLICT)
        before = {kind: _wealth_transaction_snapshot(leg) for kind, leg in locked_by_type.items()}
        checked = {}
        for kind, key in ((WealthTransaction.TransactionType.SWITCH_OUT, 'switch_out'),
                          (WealthTransaction.TransactionType.SWITCH_IN, 'switch_in')):
            item_serializer = WealthTransactionSerializer(
                locked_by_type[kind], data=request.data[key], context={'request': request, 'allow_switch_pair': True},
            )
            try:
                item_valid = item_serializer.is_valid()
            except Exception:
                switch_edit_logger.exception('switch_edit_validation_exception %s', json.dumps({
                    'switch_group_uuid': str(switch_group_id),
                    'stage': 'leg_serializer',
                    'leg': key,
                    'incoming_folio': raw_folio_legs.get(key, {}),
                }, default=str, sort_keys=True))
                raise
            if not item_valid:
                _log_switch_edit_validation(
                    switch_group_id, f'{key}_serializer', raw_folio_legs,
                    errors={key: item_serializer.errors},
                )
                return Response({key: item_serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
            checked[kind] = item_serializer
        for kind, item_serializer in checked.items():
            leg = item_serializer.save()
            WealthTransactionAudit.objects.create(
                transaction=leg, transaction_id_snapshot=leg.pk, owner=request.user,
                actor=request.user, action=WealthTransactionAudit.Action.UPDATED,
                before=before[kind], after=_wealth_transaction_snapshot(leg),
            )
    return Response({
        'switch_group_id': str(switch_group_id),
        'switch_out': WealthTransactionSerializer(locked_by_type[WealthTransaction.TransactionType.SWITCH_OUT], context={'request': request}).data,
        'switch_in': WealthTransactionSerializer(locked_by_type[WealthTransaction.TransactionType.SWITCH_IN], context={'request': request}).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_holdings(request):
    transactions = WealthTransaction.objects.filter(
        user=request.user,
        instrument__instrument_type=WealthInstrument.InstrumentType.MUTUAL_FUND,
    )
    folio_id = request.query_params.get('folio')
    if folio_id:
        if not WealthFolio.objects.filter(pk=folio_id, user=request.user).exists():
            return Response({'folio': ['Folio not found.']}, status=status.HTTP_404_NOT_FOUND)
        transactions = transactions.filter(folio_id=folio_id)
    group_by_folio = request.query_params.get('group_by') == 'folio' and not folio_id
    unit_delta = wealth_unit_delta_expression()
    values = [
        'instrument_id', 'instrument__scheme_id', 'instrument__scheme__scheme_code',
        'instrument__scheme__scheme_name', 'instrument__scheme__plan_type',
        'instrument__scheme__option_type',
    ]
    if group_by_folio:
        values.extend(['folio_id', 'folio__folio_number'])
    ordering = ['instrument__scheme__scheme_name']
    if group_by_folio:
        ordering.append('folio__folio_number')
    latest_nav = WealthMFNAVHistory.objects.filter(
        scheme_id=OuterRef('instrument__scheme_id'),
    ).order_by('-nav_date')
    holdings = (
        transactions.order_by().values(*values)
        .annotate(units=Sum(unit_delta))
        .exclude(units=0)
        .annotate(
            latest_nav=Subquery(latest_nav.values('nav')[:1], output_field=DecimalField(max_digits=18, decimal_places=4)),
            nav_date=Subquery(latest_nav.values('nav_date')[:1]),
        )
        .order_by(*ordering)
    )
    holding_rows = list(holdings)
    cost_states = wealth_moving_average_positions(request.user)
    def cost_for(row):
        scheme_id = row['instrument__scheme_id']
        if group_by_folio or folio_id:
            key = (scheme_id, row.get('folio_id'))
            return cost_states.get(key, {'units': Decimal('0'), 'invested_cost': Decimal('0'), 'average_cost_nav': None, 'realized_pl': Decimal('0'), 'dividend_income': Decimal('0'), 'reliable': True})
        related = [state for (state_scheme, _), state in cost_states.items() if state_scheme == scheme_id]
        if not related:
            return {'units': Decimal('0'), 'invested_cost': Decimal('0'), 'average_cost_nav': None, 'realized_pl': Decimal('0'), 'dividend_income': Decimal('0'), 'reliable': True}
        units_total = sum((state['units'] for state in related), Decimal('0'))
        if any(not state['reliable'] or state['units'] < 0 for state in related) or any(state['units'] < 0 for state in related):
            return {'units': units_total, 'invested_cost': None, 'average_cost_nav': None, 'realized_pl': sum((state['realized_pl'] for state in related), Decimal('0')), 'dividend_income': sum((state['dividend_income'] for state in related), Decimal('0')), 'reliable': False}
        cost = sum((state['invested_cost'] or Decimal('0') for state in related), Decimal('0'))
        return {'units': units_total, 'invested_cost': cost, 'average_cost_nav': (cost / units_total).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP) if units_total else None, 'realized_pl': sum((state['realized_pl'] for state in related), Decimal('0')), 'dividend_income': sum((state['dividend_income'] for state in related), Decimal('0')), 'reliable': True}

    def holding_payload(row):
        cost = cost_for(row)
        market_value = row['units'] * row['latest_nav'] if row['latest_nav'] is not None else None
        reliable = cost['reliable'] and cost['invested_cost'] is not None and row['units'] > 0
        unrealised = (market_value - cost['invested_cost']).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP) if reliable and market_value is not None else None
        return dict(
            instrument_id=str(row['instrument_id']), scheme_code=row['instrument__scheme__scheme_code'],
            scheme_name=row['instrument__scheme__scheme_name'],
            plan_type=row['instrument__scheme__plan_type'],
            option_type=row['instrument__scheme__option_type'],
            folio_id=str(row['folio_id']) if row.get('folio_id') else None,
            folio_number=row.get('folio__folio_number'), units=f"{row['units']:.6f}",
            position_warning='NEGATIVE_NET_UNITS' if row['units'] < 0 else None,
            latest_nav=f"{row['latest_nav']:.4f}" if row['latest_nav'] is not None else None,
            nav_date=row['nav_date'].isoformat() if row['nav_date'] else None,
            market_value=market_value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP).__format__('.2f') if market_value is not None else None,
            average_cost_nav=f"{cost['average_cost_nav']:.4f}" if reliable else None,
            invested_cost=f"{cost['invested_cost']:.2f}" if reliable else None,
            unrealised_pl=f"{unrealised:.2f}" if unrealised is not None else None,
            unrealised_return_pct=f"{(unrealised / cost['invested_cost'] * Decimal('100')):.2f}" if unrealised is not None and cost['invested_cost'] else None,
            realized_pl=f"{cost['realized_pl']:.2f}", dividend_income=f"{cost['dividend_income']:.2f}",
            cost_basis_warning='NEGATIVE_OR_UNRELIABLE_POSITION' if not reliable else None,
        )
    return Response({
        'group_by': 'folio' if group_by_folio else ('folio' if folio_id else 'aggregate'),
        'holdings': [holding_payload(row) for row in holding_rows],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_transaction_audit(request, transaction_id):
    audits = WealthTransactionAudit.objects.filter(
        owner=request.user,
        transaction_id_snapshot=transaction_id,
    )
    if not audits.exists():
        if WealthTransaction.objects.filter(pk=transaction_id, user=request.user).exists():
            return Response([])
        return Response({'detail': 'Transaction audit history not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(WealthTransactionAuditSerializer(audits, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_transaction_audit_log(request):
    audits = WealthTransactionAudit.objects.filter(owner=request.user).select_related('actor')
    return Response(WealthTransactionAuditSerializer(audits, many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_sip_mandates(request):
    if request.method == 'GET':
        generate_for_active_mandates(request.user)
        mandates = WealthSIPMandate.objects.filter(user=request.user).select_related('scheme', 'folio')
        return Response(WealthSIPMandateSerializer(mandates, many=True, context={'request': request}).data)
    serializer = WealthSIPMandateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        mandate = serializer.save(user=request.user)
        generate_due_installments(mandate)
    return Response(WealthSIPMandateSerializer(mandate, context={'request': request}).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_sip_mandate_detail(request, mandate_id):
    if request.method == 'DELETE':
        with transaction.atomic():
            mandate = get_object_or_404(
                WealthSIPMandate.objects.select_for_update(of=('self',)),
                pk=mandate_id, user=request.user,
            )
            # Serialize deletion against concurrent confirmation of any installment.
            list(WealthSIPInstallment.objects.select_for_update(of=('self',)).filter(mandate=mandate))
            reason = wealth_sip_mandate_delete_block_reason(mandate)
            if reason:
                return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)
            mandate.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    mandate = get_object_or_404(WealthSIPMandate.objects.select_related('scheme', 'folio'), pk=mandate_id, user=request.user)
    serializer = WealthSIPMandateSerializer(mandate, data=request.data, partial=True, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        mandate = get_object_or_404(
            WealthSIPMandate.objects.select_for_update(of=('self',)).select_related('scheme', 'folio'),
            pk=mandate_id, user=request.user,
        )
        serializer = WealthSIPMandateSerializer(
            mandate, data=request.data, partial=True, context={'request': request},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        if (request.data.get('status') == WealthSIPMandate.Status.PAUSED
                and mandate.status == WealthSIPMandate.Status.ACTIVE):
            generate_due_installments(mandate)
            from calendar import monthrange
            today = timezone.localdate()
            mandate.generated_through = today.replace(
                day=monthrange(today.year, today.month)[1],
            )
            mandate.save(update_fields=['generated_through', 'updated_at'])
        mandate = serializer.save()
    return Response(WealthSIPMandateSerializer(mandate, context={'request': request}).data)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_sip_installments(request, installment_id=None):
    if request.method == 'GET':
        generate_for_active_mandates(request.user)
        installments = WealthSIPInstallment.objects.filter(mandate__user=request.user).select_related('mandate__scheme', 'mandate__folio')
        status_filter = request.query_params.get('status')
        if status_filter in {item.value for item in WealthSIPInstallment.Status}:
            installments = installments.filter(status=status_filter)
        return Response(WealthSIPInstallmentSerializer(installments, many=True).data)
    installment = get_object_or_404(WealthSIPInstallment.objects.select_related('mandate__scheme', 'mandate__folio'), pk=installment_id, mandate__user=request.user)
    serializer = WealthSIPInstallmentSerializer(installment, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    return Response(WealthSIPInstallmentSerializer(serializer.save()).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, HasWealthAccess])
def wealth_sip_confirm_installment(request, installment_id):
    payload = WealthSIPConfirmSerializer(data=request.data)
    if not payload.is_valid():
        return Response(payload.errors, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        installment = get_object_or_404(
            WealthSIPInstallment.objects.select_for_update(of=('self',)).select_related(
                'mandate__scheme', 'mandate__folio',
            ),
            pk=installment_id, mandate__user=request.user,
        )
        if installment.status != WealthSIPInstallment.Status.PENDING or installment.transaction_id is not None:
            return Response({'detail': 'This installment has already been confirmed.'}, status=status.HTTP_409_CONFLICT)
        data = payload.validated_data
        nav = data['actual_nav']
        purchase_values = calculate_sip_purchase_values(
            installment.amount, nav, data['actual_date'],
            actual_charges=data.get('actual_charges'),
            charges_source=data.get('charges_source'),
        )
        if purchase_values['amount'] <= 0 or purchase_values['units'] <= 0:
            return Response(
                {'actual_charges': 'Charges must be less than the scheduled SIP total debit.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        units = purchase_values['units']
        amount = purchase_values['amount']
        charges = purchase_values['charges']
        cashflow = purchase_values['cashflow']
        instrument, _ = WealthInstrument.objects.get_or_create(
            scheme=installment.mandate.scheme,
            defaults={'instrument_type': WealthInstrument.InstrumentType.MUTUAL_FUND},
        )
        actual = WealthTransaction.objects.create(
            user=request.user, instrument=instrument, folio=installment.mandate.folio,
            transaction_type=WealthTransaction.TransactionType.PURCHASE,
            transaction_date=data['actual_date'], source=WealthTransaction.Source.SIP,
            source_reference=f'SIP installment {installment.pk}', notes=data.get('notes', ''),
        )
        detail = WealthMFTransactionDetail.objects.create(
            transaction=actual, units=units, nav=nav, amount=amount, charges=charges,
            cashflow=cashflow, charges_source=purchase_values['charges_source'],
            charges_breakdown=purchase_values['charges_breakdown'],
        )
        actual = WealthTransaction.objects.select_related('instrument__scheme', 'folio', 'mf_detail').get(pk=actual.pk)
        WealthTransactionAudit.objects.create(
            transaction=actual, transaction_id_snapshot=actual.pk, owner=request.user,
            actor=request.user, action=WealthTransactionAudit.Action.CREATED,
            after=_wealth_transaction_snapshot(actual),
        )
        installment.status = WealthSIPInstallment.Status.CONFIRMED
        installment.transaction = actual
        installment.transaction_id_snapshot = actual.pk
        installment.save(update_fields=['status', 'transaction', 'transaction_id_snapshot', 'updated_at'])
    return Response({
        'installment': WealthSIPInstallmentSerializer(installment).data,
        'transaction': WealthTransactionSerializer(actual, context={'request': request}).data,
    }, status=status.HTTP_201_CREATED)
