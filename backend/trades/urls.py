from django.urls import path
from . import views

urlpatterns = [
    path('<uuid:portfolio_id>/trades/',
         views.TradeListCreateView.as_view(), name='trade-list'),
    path('<uuid:portfolio_id>/trades/<uuid:pk>/',
         views.TradeDetailView.as_view(), name='trade-detail'),
    path('<uuid:portfolio_id>/trades/<uuid:pk>/close/',
         views.close_trade, name='trade-close'),
    path('<uuid:portfolio_id>/trades/import/',
         views.import_csv, name='trade-import'),
    path('<uuid:portfolio_id>/trades/bulk/',
         views.bulk_import_trades, name='trade-bulk'),
    path('<uuid:portfolio_id>/trades/clear/',
         views.clear_trades, name='trade-clear'),
    path('<uuid:portfolio_id>/trades/sample-csv/',
         views.sample_csv, name='trade-sample-csv'),
    path('<uuid:portfolio_id>/trades/export/',
         views.export_csv, name='trade-export'),
    path('<uuid:portfolio_id>/stats/',
         views.stats, name='trade-stats'),
    path('<uuid:portfolio_id>/stats/equity-curve/',
         views.equity_curve, name='equity-curve'),
    path('<uuid:portfolio_id>/stats/monthly-pnl/',
         views.monthly_pnl, name='monthly-pnl'),
    path('<uuid:portfolio_id>/stats/closed-months/',
         views.closed_months, name='closed-months'),
]