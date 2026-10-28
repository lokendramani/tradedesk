from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.db.models.functions import Lower, Trim
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone

from users.permissions import HasWealthAccess
from .models import CashFlowCategory, CashFlowEntry, CashFlowProfile, WealthMilestone
from .serializers import CashFlowCategorySerializer, CashFlowEntrySerializer, WealthMilestoneSerializer


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
