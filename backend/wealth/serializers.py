from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from .models import (
    CashFlowCategory, CashFlowEntry, MutualFundScheme, WealthFundHouse,
    WealthFolio, WealthInstrument, WealthMFTransactionDetail, WealthMilestone,
    WealthSIPInstallment, WealthSIPMandate, WealthTransaction, WealthTransactionAudit,
)


def wealth_folio_delete_block_reason(folio):
    if not hasattr(folio, '_wealth_delete_block_reason'):
        reasons = []
        if WealthTransaction.objects.filter(folio_id=folio.pk).exists():
            reasons.append('This folio has transaction history and cannot be deleted.')
        if WealthSIPMandate.objects.filter(folio_id=folio.pk).exists():
            reasons.append('This folio is linked to one or more SIP mandates.')
        folio._wealth_delete_block_reason = ' '.join(reasons) or None
    return folio._wealth_delete_block_reason


def wealth_sip_mandate_delete_block_reason(mandate):
    if not hasattr(mandate, '_wealth_delete_block_reason'):
        has_live_transactions = WealthSIPInstallment.objects.filter(
            mandate_id=mandate.pk, transaction__isnull=False,
        ).exists()
        mandate._wealth_delete_block_reason = (
            'This mandate has linked confirmed purchases. Delete those transactions before deleting the mandate.'
            if has_live_transactions else None
        )
    return mandate._wealth_delete_block_reason


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
    fund_house_master_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = MutualFundScheme
        fields = [
            'scheme_code', 'scheme_name', 'fund_house', 'category_name',
            'fund_house_master_id',
            'asset_class', 'plan_type', 'option_type', 'isin_growth',
            'isin_div_payout', 'isin_div_reinvestment',
        ]


class WealthFundHouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = WealthFundHouse
        fields = ['id', 'name']
        read_only_fields = fields


class WealthFolioSerializer(serializers.ModelSerializer):
    fund_house_name = serializers.CharField(source='fund_house.name', read_only=True, default=None)
    can_delete = serializers.SerializerMethodField()
    delete_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = WealthFolio
        fields = ['id', 'folio_number', 'name', 'fund_house', 'fund_house_name', 'can_delete', 'delete_block_reason', 'created_at', 'updated_at']
        read_only_fields = ['id', 'fund_house_name', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if request:
            fields['fund_house'].queryset = WealthFundHouse.objects.all()
        return fields

    def _delete_block_reason(self, obj):
        return wealth_folio_delete_block_reason(obj)

    def get_can_delete(self, obj):
        return self._delete_block_reason(obj) is None

    def get_delete_block_reason(self, obj):
        return self._delete_block_reason(obj)

    def validate_folio_number(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Folio number cannot be blank.')
        return value

    def validate(self, attrs):
        if self.instance:
            fund_house = attrs.get('fund_house', self.instance.fund_house)
            if fund_house:
                mismatched = self.instance.transactions.exclude(
                    instrument__scheme__fund_house_master=fund_house,
                ).exists()
                if mismatched:
                    raise serializers.ValidationError({
                        'fund_house': 'Folio fund house cannot conflict with its existing transactions.'
                    })
        return attrs


class WealthInstrumentSerializer(serializers.ModelSerializer):
    scheme_code = serializers.CharField(source='scheme.scheme_code', read_only=True)
    scheme_name = serializers.CharField(source='scheme.scheme_name', read_only=True)
    fund_house = serializers.CharField(source='scheme.fund_house', read_only=True)

    class Meta:
        model = WealthInstrument
        fields = ['id', 'instrument_type', 'scheme_code', 'scheme_name', 'fund_house']
        read_only_fields = fields


class WealthMFTransactionDetailSerializer(serializers.ModelSerializer):
    units = serializers.DecimalField(max_digits=22, decimal_places=4, min_value=Decimal('0'))
    nav = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal('0'))
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal('0'))
    charges = serializers.DecimalField(
        max_digits=18, decimal_places=2, min_value=Decimal('0'), required=False,
        default=Decimal('0'),
    )
    charges_source = serializers.ChoiceField(
        choices=WealthMFTransactionDetail.ChargesSource.choices,
        required=False,
        default=WealthMFTransactionDetail.ChargesSource.MANUAL,
    )
    charges_breakdown = serializers.JSONField(required=False, default=dict)
    cashflow = serializers.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        model = WealthMFTransactionDetail
        fields = ['units', 'nav', 'amount', 'charges', 'charges_source', 'charges_breakdown', 'cashflow']


class WealthTransactionSerializer(serializers.ModelSerializer):
    scheme_code = serializers.CharField(write_only=True, max_length=32)
    scheme = MutualFundSchemeSerializer(source='instrument.scheme', read_only=True)
    instrument = WealthInstrumentSerializer(read_only=True)
    folio = serializers.PrimaryKeyRelatedField(
        queryset=WealthFolio.objects.none(), allow_null=True, required=False,
    )
    mf_detail = WealthMFTransactionDetailSerializer()
    switch_group_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = WealthTransaction
        fields = [
            'id', 'transaction_type', 'transaction_date', 'source', 'source_reference',
            'scheme_code', 'scheme', 'instrument', 'folio', 'switch_group_id',
            'mf_detail', 'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'scheme', 'instrument', 'switch_group_id', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if request:
            fields['folio'].queryset = WealthFolio.objects.filter(user=request.user)
        return fields

    def validate(self, attrs):
        transaction_type = attrs.get(
            'transaction_type',
            self.instance.transaction_type if self.instance else None,
        )
        if transaction_type in {
            WealthTransaction.TransactionType.SWITCH_OUT,
            WealthTransaction.TransactionType.SWITCH_IN,
        } and not self.context.get('allow_switch_pair'):
            raise serializers.ValidationError({
                'transaction_type': 'Create switch records together through the paired switch endpoint.'
            })

        if self.instance and transaction_type != self.instance.transaction_type and (
            self.instance.transaction_type in {
                WealthTransaction.TransactionType.SWITCH_OUT,
                WealthTransaction.TransactionType.SWITCH_IN,
            }
            or transaction_type in {
                WealthTransaction.TransactionType.SWITCH_OUT,
                WealthTransaction.TransactionType.SWITCH_IN,
            }
        ):
            raise serializers.ValidationError({'transaction_type': 'A switch leg cannot be changed independently.'})

        scheme_code = attrs.get('scheme_code')
        if scheme_code:
            try:
                scheme = MutualFundScheme.objects.get(scheme_code=scheme_code)
            except MutualFundScheme.DoesNotExist:
                raise serializers.ValidationError({'scheme_code': 'Unknown mutual fund scheme code.'})
        elif self.instance and self.instance.instrument.scheme_id:
            scheme = self.instance.instrument.scheme
        else:
            raise serializers.ValidationError({'scheme_code': 'A mutual fund scheme is required.'})

        folio = attrs.get('folio', self.instance.folio if self.instance else None)
        if folio and folio.fund_house_id and scheme.fund_house_master_id != folio.fund_house_id:
            raise serializers.ValidationError({'folio': 'Folio fund house must match the selected scheme.'})

        source = attrs.get('source', self.instance.source if self.instance else WealthTransaction.Source.MANUAL)
        if source == WealthTransaction.Source.SIP and transaction_type != WealthTransaction.TransactionType.PURCHASE:
            raise serializers.ValidationError({'source': 'SIP source is valid only for purchase transactions.'})

        detail_data = attrs.get('mf_detail')
        detail_data_for_validation = detail_data
        if self.instance:
            detail_data_for_validation = {
                field: getattr(self.instance.mf_detail, field)
                for field in ('units', 'nav', 'amount', 'charges', 'cashflow')
            }
            if detail_data:
                detail_data_for_validation.update(detail_data)
        if detail_data_for_validation is not None:
            detail = WealthMFTransactionDetail(**detail_data_for_validation)
            detail.transaction = WealthTransaction(
                transaction_type=transaction_type,
                source=source,
            )
            try:
                detail.clean()
            except DjangoValidationError as exc:
                raise serializers.ValidationError({'mf_detail': exc.message_dict})
        elif not self.instance:
            raise serializers.ValidationError({'mf_detail': 'Transaction detail is required.'})
        return attrs

    def create(self, validated_data):
        scheme_code = validated_data.pop('scheme_code')
        detail_data = validated_data.pop('mf_detail')
        scheme = MutualFundScheme.objects.get(scheme_code=scheme_code)
        instrument, _ = WealthInstrument.objects.get_or_create(
            scheme=scheme,
            defaults={'instrument_type': WealthInstrument.InstrumentType.MUTUAL_FUND},
        )
        transaction = WealthTransaction.objects.create(instrument=instrument, **validated_data)
        WealthMFTransactionDetail.objects.create(transaction=transaction, **detail_data)
        return transaction

    def update(self, instance, validated_data):
        scheme_code = validated_data.pop('scheme_code', None)
        detail_data = validated_data.pop('mf_detail', None)
        if scheme_code and scheme_code != instance.instrument.scheme.scheme_code:
            scheme = MutualFundScheme.objects.get(scheme_code=scheme_code)
            instance.instrument, _ = WealthInstrument.objects.get_or_create(
                scheme=scheme,
                defaults={'instrument_type': WealthInstrument.InstrumentType.MUTUAL_FUND},
            )
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.full_clean()
        instance.save()
        if detail_data:
            detail = instance.mf_detail
            for field, value in detail_data.items():
                setattr(detail, field, value)
            detail.full_clean()
            detail.save()
        return instance


class WealthSwitchPairSerializer(serializers.Serializer):
    switch_out = WealthTransactionSerializer()
    switch_in = WealthTransactionSerializer()

    def validate(self, attrs):
        switch_out = attrs['switch_out']
        switch_in = attrs['switch_in']
        if switch_out.get('transaction_type') != WealthTransaction.TransactionType.SWITCH_OUT:
            raise serializers.ValidationError({'switch_out': 'The first leg must be SWITCH_OUT.'})
        if switch_in.get('transaction_type') != WealthTransaction.TransactionType.SWITCH_IN:
            raise serializers.ValidationError({'switch_in': 'The second leg must be SWITCH_IN.'})
        if switch_out.get('transaction_date') != switch_in.get('transaction_date'):
            raise serializers.ValidationError('Both switch legs must use the same transaction date.')
        return attrs


class WealthTransactionAuditSerializer(serializers.ModelSerializer):
    actor_id = serializers.ReadOnlyField()

    class Meta:
        model = WealthTransactionAudit
        fields = ['id', 'transaction_id_snapshot', 'action', 'before', 'after', 'actor_id', 'created_at']
        read_only_fields = fields


class WealthSIPMandateSerializer(serializers.ModelSerializer):
    scheme_code = serializers.CharField(write_only=True, max_length=32)
    scheme_name = serializers.CharField(source='scheme.scheme_name', read_only=True)
    fund_house = serializers.CharField(source='scheme.fund_house', read_only=True)
    plan_type = serializers.CharField(source='scheme.plan_type', read_only=True)
    option_type = serializers.CharField(source='scheme.option_type', read_only=True)
    folio = serializers.PrimaryKeyRelatedField(
        queryset=WealthFolio.objects.none(), allow_null=True, required=False,
    )
    frequency = serializers.CharField(read_only=True, default='MONTHLY')
    can_delete = serializers.SerializerMethodField()
    delete_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = WealthSIPMandate
        fields = [
            'id', 'scheme_code', 'scheme_name', 'fund_house', 'plan_type', 'option_type', 'folio',
            'monthly_amount', 'frequency', 'sip_day', 'start_date',
            'generate_from_date', 'end_date', 'generated_through', 'status',
            'can_delete', 'delete_block_reason', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'scheme_name', 'fund_house', 'plan_type', 'option_type', 'frequency', 'generated_through', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if request:
            fields['folio'].queryset = WealthFolio.objects.filter(user=request.user)
        return fields

    def _delete_block_reason(self, obj):
        return wealth_sip_mandate_delete_block_reason(obj)

    def get_can_delete(self, obj):
        return self._delete_block_reason(obj) is None

    def get_delete_block_reason(self, obj):
        return self._delete_block_reason(obj)

    def validate(self, attrs):
        scheme_code = attrs.get('scheme_code')
        if scheme_code:
            try:
                scheme = MutualFundScheme.objects.get(scheme_code=scheme_code)
            except MutualFundScheme.DoesNotExist:
                raise serializers.ValidationError({'scheme_code': 'Unknown mutual fund scheme code.'})
        elif self.instance:
            scheme = self.instance.scheme
        else:
            raise serializers.ValidationError({'scheme_code': 'A mutual fund scheme is required.'})

        folio = attrs.get('folio', self.instance.folio if self.instance else None)
        if folio and folio.fund_house_id and scheme.fund_house_master_id != folio.fund_house_id:
            raise serializers.ValidationError({'folio': 'Folio fund house must match the selected scheme.'})

        monthly_amount = attrs.get('monthly_amount', self.instance.monthly_amount if self.instance else None)
        if monthly_amount is not None and monthly_amount <= 0:
            raise serializers.ValidationError({'monthly_amount': 'Monthly amount must be greater than zero.'})

        start_date = attrs.get('start_date', self.instance.start_date if self.instance else None)
        generate_from = attrs.get('generate_from_date', self.instance.generate_from_date if self.instance else None)
        end_date = attrs.get('end_date', self.instance.end_date if self.instance else None)
        if start_date and generate_from and generate_from < start_date:
            raise serializers.ValidationError({'generate_from_date': 'Installments cannot be generated before the SIP start date.'})
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError({'end_date': 'End date cannot be before the SIP start date.'})
        if self.instance and self.instance.status == WealthSIPMandate.Status.COMPLETED and attrs.get('status') == WealthSIPMandate.Status.ACTIVE:
            raise serializers.ValidationError({'status': 'A completed SIP mandate cannot be reactivated.'})
        return attrs

    def create(self, validated_data):
        scheme_code = validated_data.pop('scheme_code')
        validated_data['scheme'] = MutualFundScheme.objects.get(scheme_code=scheme_code)
        return WealthSIPMandate.objects.create(**validated_data)

    def update(self, instance, validated_data):
        scheme_code = validated_data.pop('scheme_code', None)
        if scheme_code:
            instance.scheme = MutualFundScheme.objects.get(scheme_code=scheme_code)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.full_clean()
        instance.save()
        return instance


class WealthSIPInstallmentSerializer(serializers.ModelSerializer):
    mandate_id = serializers.UUIDField(read_only=True)
    scheme_code = serializers.CharField(source='mandate.scheme.scheme_code', read_only=True)
    scheme_name = serializers.CharField(source='mandate.scheme.scheme_name', read_only=True)
    plan_type = serializers.CharField(source='mandate.scheme.plan_type', read_only=True)
    option_type = serializers.CharField(source='mandate.scheme.option_type', read_only=True)
    folio_id = serializers.UUIDField(source='mandate.folio_id', read_only=True, allow_null=True)
    sip_day = serializers.IntegerField(source='mandate.sip_day', read_only=True)
    monthly_amount = serializers.DecimalField(source='mandate.monthly_amount', max_digits=18, decimal_places=2, read_only=True)

    class Meta:
        model = WealthSIPInstallment
        fields = [
            'id', 'mandate_id', 'scheme_code', 'scheme_name', 'plan_type', 'option_type', 'folio_id', 'sip_day',
            'monthly_amount', 'scheduled_date', 'amount', 'status',
            'transaction_id_snapshot', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'mandate_id', 'scheme_code', 'scheme_name', 'plan_type', 'option_type', 'folio_id', 'sip_day', 'monthly_amount', 'status', 'transaction_id_snapshot', 'created_at', 'updated_at']

    def validate(self, attrs):
        instance = self.instance
        if instance and instance.status != WealthSIPInstallment.Status.PENDING:
            raise serializers.ValidationError({'detail': 'Only pending installments can be edited.'})
        scheduled_date = attrs.get('scheduled_date', instance.scheduled_date if instance else None)
        amount = attrs.get('amount', instance.amount if instance else None)
        if instance and scheduled_date and scheduled_date < instance.mandate.start_date:
            raise serializers.ValidationError({'scheduled_date': 'Installment cannot precede the SIP start date.'})
        if instance and scheduled_date and instance.mandate.end_date and scheduled_date > instance.mandate.end_date:
            raise serializers.ValidationError({'scheduled_date': 'Installment cannot fall after the SIP end date.'})
        if amount is not None and amount <= 0:
            raise serializers.ValidationError({'amount': 'Installment amount must be greater than zero.'})
        return attrs


class WealthSIPConfirmSerializer(serializers.Serializer):
    actual_date = serializers.DateField()
    actual_nav = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal('0.0001'))
    actual_charges = serializers.DecimalField(
        max_digits=18, decimal_places=2, min_value=Decimal('0'), required=False,
    )
    charges_source = serializers.ChoiceField(
        choices=WealthMFTransactionDetail.ChargesSource.choices, required=False,
    )
    notes = serializers.CharField(required=False, allow_blank=True)
