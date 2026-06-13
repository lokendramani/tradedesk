from django.urls import path
from . import views

urlpatterns = [
    path('upload/',                        views.upload_csv,          name='sip-upload'),
    path('trades/',                        views.trades_list_or_add,  name='sip-trades'),
    path('trades/<uuid:pk>/close/',        views.close_trade,         name='sip-close-trade'),
    path('holdings/',                      views.holdings,            name='sip-holdings'),
    path('booked-pl/',                     views.booked_pl,           name='sip-booked-pl'),
    path('sell/',                          views.sell,                name='sip-sell'),
    path('dashboard/',                     views.dashboard,           name='sip-dashboard'),
    path('refresh-prices/',                views.refresh_prices,      name='sip-refresh'),
    path('clear/',                         views.clear_data,          name='sip-clear'),
    path('etf-master/',                    views.etf_master_list,     name='sip-etf-master-list'),
    path('etf-master/<str:ticker>/',       views.etf_master_detail,   name='sip-etf-master-detail'),
]
