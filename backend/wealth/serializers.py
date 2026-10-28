from rest_framework import serializers
from django.db.models.functions import Lower, Trim

from .models import CashFlowCategory, CashFlowEntry


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
