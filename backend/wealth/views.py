from django.db import IntegrityError, transaction
from django.db.models import Sum
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
from .models import CashFlowCategory, CashFlowEntry, CashFlowProfile, MutualFundScheme, WealthMilestone
from .scheme_catalogue import (
    CatalogueError, catalogue_is_populated, initialize_scheme_catalogue, refresh_scheme_catalogue,
)
from .serializers import CashFlowCategorySerializer, CashFlowEntrySerializer, MutualFundSchemeSerializer, WealthMilestoneSerializer


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
        queryset = queryset.filter(Q(scheme_name__icontains=search) | Q(scheme_code__icontains=search) | Q(fund_house__icontains=search))

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
