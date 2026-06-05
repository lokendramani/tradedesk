from django.urls import path
from . import views

urlpatterns = [
    path('import/',       views.import_cas,        name='mf-import'),
    path('dashboard/',    views.dashboard,          name='mf-dashboard'),
    path('schemes/',      views.schemes_list,       name='mf-schemes'),
    path('transactions/', views.transactions_list,  name='mf-transactions'),
    path('delete/',       views.delete_all,         name='mf-delete'),
]
