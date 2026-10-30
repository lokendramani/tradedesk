from django.urls import path

from . import views

urlpatterns = [
    path('schemes/', views.scheme_catalogue, name='wealth-scheme-catalogue'),
    path('schemes/filters/', views.scheme_catalogue_filters, name='wealth-scheme-catalogue-filters'),
    path('schemes/refresh/', views.scheme_catalogue_refresh, name='wealth-scheme-catalogue-refresh'),
    path('schemes/<str:scheme_code>/', views.scheme_catalogue_detail, name='wealth-scheme-catalogue-detail'),
    path('cash-flow/', views.cash_flow_profile, name='wealth-cash-flow-profile'),
    path('cash-flow/categories/', views.cash_flow_categories, name='wealth-cash-flow-categories'),
    path('cash-flow/categories/<int:pk>/', views.cash_flow_category_detail, name='wealth-cash-flow-category-detail'),
    path('cash-flow/entries/', views.cash_flow_entries, name='wealth-cash-flow-entries'),
    path('cash-flow/entries/<int:pk>/', views.cash_flow_entry_detail, name='wealth-cash-flow-entry-detail'),
    path('milestones/', views.wealth_milestones, name='wealth-milestones'),
    path('milestones/<int:pk>/', views.wealth_milestone_detail, name='wealth-milestone-detail'),
]
