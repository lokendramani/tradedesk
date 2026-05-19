from django.urls import path
from . import views

urlpatterns = [
    path('',          views.PortfolioListCreateView.as_view(), name='portfolio-list'),
    path('<uuid:pk>/', views.PortfolioDetailView.as_view(),    name='portfolio-detail'),
]