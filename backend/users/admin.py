from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils import timezone
from .models import AppModule, User, UserModuleAccess

@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display  = ['email', 'full_name', 'role', 'is_active', 'created_at']
    list_filter   = ['role', 'is_active']
    search_fields = ['email', 'full_name']
    ordering      = ['-created_at']
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Personal', {'fields': ('full_name',)}),
        ('Permissions', {'fields': ('role', 'is_active', 'is_staff', 'is_superuser')}),
    )
    add_fieldsets = (
        (None, {'fields': ('email', 'password1', 'password2', 'full_name')}),
    )


@admin.register(AppModule)
class AppModuleAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'is_active']
    list_filter = ['is_active']
    search_fields = ['code', 'name']

    def get_readonly_fields(self, request, obj=None):
        return ['code'] if obj else []

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(UserModuleAccess)
class UserModuleAccessAdmin(admin.ModelAdmin):
    list_display = [
        'subject_email_snapshot', 'module', 'granted_at', 'grantor_email_snapshot',
        'revoked_at', 'revoker_email_snapshot',
    ]
    list_filter = ['module', 'revoked_at']
    search_fields = [
        'subject_email_snapshot', 'subject_name_snapshot', 'module__code',
        'grantor_email_snapshot', 'revoker_email_snapshot',
    ]
    autocomplete_fields = ['user', 'module']
    actions = ['revoke_selected_grants']

    def get_readonly_fields(self, request, obj=None):
        if obj:
            return [
                'user', 'module', 'subject_user_id_snapshot', 'subject_email_snapshot',
                'subject_name_snapshot', 'granted_by', 'grantor_id_snapshot',
                'grantor_email_snapshot', 'grantor_name_snapshot', 'granted_at',
                'revoked_at', 'revoked_by', 'revoker_id_snapshot',
                'revoker_email_snapshot', 'revoker_name_snapshot',
            ]
        return [
            'subject_user_id_snapshot', 'subject_email_snapshot', 'subject_name_snapshot',
            'granted_by', 'grantor_id_snapshot', 'grantor_email_snapshot',
            'grantor_name_snapshot', 'granted_at', 'revoked_at', 'revoked_by',
            'revoker_id_snapshot', 'revoker_email_snapshot', 'revoker_name_snapshot',
        ]

    def save_model(self, request, obj, form, change):
        if not change:
            obj.granted_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description='Revoke selected active module grants')
    def revoke_selected_grants(self, request, queryset):
        queryset.filter(revoked_at__isnull=True).update(
            revoked_at=timezone.now(),
            revoked_by=request.user,
            revoker_id_snapshot=request.user.pk,
            revoker_email_snapshot=request.user.email,
            revoker_name_snapshot=request.user.full_name,
        )

    def has_delete_permission(self, request, obj=None):
        return False
