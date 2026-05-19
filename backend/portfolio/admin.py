from django.contrib import admin
from .models import Portfolio

@admin.register(Portfolio)
class PortfolioAdmin(admin.ModelAdmin):
    list_display  = ['name', 'user', 'type', 'starting_capital', 'created_at']
    list_filter   = ['type']
    search_fields = ['name', 'user__email']