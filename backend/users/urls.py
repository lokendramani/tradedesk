from django.urls import path
from . import views

urlpatterns = [
    path('register/',      views.register,     name='auth-register'),
    path('login/',         views.login,         name='auth-login'),
    path('token/refresh/', views.refresh_token, name='auth-refresh'),
    path('me/',            views.me,            name='auth-me'),
    path('admin/users/',   views.admin_users,   name='admin-users'),
]