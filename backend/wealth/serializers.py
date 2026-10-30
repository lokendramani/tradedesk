from rest_framework import serializers
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from .models import CashFlowCategory, CashFlowEntry, MutualFundScheme, WealthMilestone


class CashFlowCategorySerializer(serializers.ModelSerializer):
    is_archived = serializers.BooleanField(required=False)

    class Meta:
        model = CashFlowCategory
        fields = ['id', 'section', 'name', 'is_archived']
        read_only_fields = ['id']

    def get_fields(self):
        fields = super().get_fields()
        if self.instance:
            fields['section'].read_only = True
        return fields

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Category name cannot be blank.')
        return value

    def validate(self, attrs):
        if self.context.get('handle_category_name_conflicts'):
            return attrs

        request = self.context['request']
        name = attrs.get('name', self.instance.name if self.instance else '')
        section = attrs.get('section', self.instance.section if self.instance else None)
        is_archived = attrs.get('is_archived', self.instance.is_archived if self.instance else False)
        if not is_archived and section and name:
            duplicates = CashFlowCategory.objects.filter(
                user=request.user,
                section=section,
                is_archived=False,
            ).annotate(normalized_name=Lower(Trim('name'))).filter(normalized_name=name.lower())
            if self.instance:
                duplicates = duplicates.exclude(pk=self.instance.pk)
            if duplicates.exists():
                raise serializers.ValidationError({'name': 'This category already exists.'})
        return attrs


class CashFlowEntrySerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    section = serializers.CharField(source='category.section', read_only=True)

    class Meta:
        model = CashFlowEntry
        fields = ['id', 'name', 'category', 'category_name', 'section', 'amount']
        read_only_fields = ['id', 'category_name', 'section']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Entry name cannot be blank.')
        return value

    def validate_category(self, category):
        request = self.context['request']
        if category.user_id != request.user.pk:
            raise serializers.ValidationError('Choose one of your own categories.')
        if category.is_archived and not (
            self.instance and self.instance.category_id == category.pk
        ):
            raise serializers.ValidationError('Archived categories cannot be used for new entries.')
        return category


class WealthMilestoneSerializer(serializers.ModelSerializer):
    years_remaining = serializers.SerializerMethodField()
    future_amount = serializers.SerializerMethodField()
    required_monthly_sip = serializers.SerializerMethodField()

    class Meta:
        model = WealthMilestone
        fields = [
            'id',
            'name',
            'present_amount',
            'target_year',
            'inflation_rate',
            'expected_return_rate',
            'years_remaining',
            'future_amount',
            'required_monthly_sip',
        ]
        read_only_fields = ['id', 'years_remaining', 'future_amount', 'required_monthly_sip']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Goal name cannot be blank.')
        return value

    def validate_target_year(self, value):
        current_year = timezone.localdate().year
        if value <= current_year:
            raise serializers.ValidationError('Target year must be in the future.')
        if value > current_year + 100:
            raise serializers.ValidationError('Target year cannot be more than 100 years away.')
        return value

    def validate(self, attrs):
        target_year = attrs.get('target_year', self.instance.target_year if self.instance else None)
        if target_year is not None:
            current_year = timezone.localdate().year
            if target_year <= current_year:
                raise serializers.ValidationError({'target_year': 'Target year must be in the future.'})
            if target_year > current_year + 100:
                raise serializers.ValidationError({'target_year': 'Target year cannot be more than 100 years away.'})
        return attrs

    def _projection(self, obj):
        return obj.calculate_projection()

    def get_years_remaining(self, obj):
        return self._projection(obj)['years_remaining']

    def get_future_amount(self, obj):
        value = self._projection(obj)['future_amount']
        return f'{value:.2f}'

    def get_required_monthly_sip(self, obj):
        value = self._projection(obj)['required_monthly_sip']
        return f'{value:.2f}' if value is not None else None


class MutualFundSchemeSerializer(serializers.ModelSerializer):
    class Meta:
        model = MutualFundScheme
        fields = [
            'scheme_code', 'scheme_name', 'fund_house', 'category_name',
            'asset_class', 'plan_type', 'option_type', 'isin_growth',
            'isin_div_payout', 'isin_div_reinvestment',
        ]
