from django.contrib import admin
from .models import Trade

@admin.register(Trade)
class TradeAdmin(admin.ModelAdmin):
    list_display    = ['scrip_name', 'segment', 'direction', 'entry_date',
                       'entry_price', 'quantity', 'close_date', 'net_income', 'portfolio']
    list_filter     = ['segment', 'direction', 'entry_date']
    search_fields   = ['scrip_name', 'portfolio__name', 'portfolio__user__email']
    readonly_fields = ['target', 'initial_risk', 'gross_pl', 'charges', 'net_income', 'risk_reward']
    ordering        = ['-entry_date']