from django_filters import rest_framework as filters
from .models import Trade

class TradeFilter(filters.FilterSet):
    segment     = filters.CharFilter(field_name='segment')
    direction   = filters.CharFilter(field_name='direction')
    from_date   = filters.DateFilter(field_name='entry_date', lookup_expr='gte')
    to_date     = filters.DateFilter(field_name='entry_date', lookup_expr='lte')
    only_open   = filters.BooleanFilter(method='filter_open')
    only_closed = filters.BooleanFilter(method='filter_closed')
    only_profit = filters.BooleanFilter(method='filter_profit')
    only_loss   = filters.BooleanFilter(method='filter_loss')

    def filter_open(self, qs, name, value):
        if value:
            return qs.filter(close_date__isnull=True, close_price__isnull=True)
        return qs

    def filter_closed(self, qs, name, value):
        if value:
            return qs.exclude(close_date__isnull=True, close_price__isnull=True)
        return qs

    def filter_profit(self, qs, name, value):
        if value:
            return qs.filter(net_income__gt=0)
        return qs

    def filter_loss(self, qs, name, value):
        if value:
            return qs.filter(net_income__lt=0)
        return qs

    class Meta:
        model  = Trade
        fields = ['segment', 'direction']