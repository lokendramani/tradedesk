from rest_framework import serializers
from .models import Trade

class TradeSerializer(serializers.ModelSerializer):
    is_closed = serializers.ReadOnlyField()

    class Meta:
        model  = Trade
        fields = [
            'id', 'scrip_name', 'segment', 'direction', 'legs',
            'entry_date', 'entry_price', 'quantity', 'stop_loss',
            'target', 'initial_risk',
            'close_date', 'close_price',
            'gross_pl', 'charges', 'net_income', 'risk_reward',
            'notes', 'is_closed', 'created_at'
        ]
        read_only_fields = ['id', 'target', 'initial_risk', 'gross_pl',
                            'charges', 'net_income', 'risk_reward', 'created_at']

class CloseTradeSerializer(serializers.Serializer):
    close_date  = serializers.DateField()
    close_price = serializers.DecimalField(max_digits=15, decimal_places=4)