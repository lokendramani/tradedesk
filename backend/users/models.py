from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
import uuid

class UserManager(BaseUserManager):
    def create_user(self, email, password, full_name, **extra):
        if not email:
            raise ValueError('Email required')
        email = self.normalize_email(email)
        user = self.model(email=email, full_name=full_name, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password, full_name='Admin', **extra):
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        return self.create_user(email, password, full_name, **extra)

class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        USER  = 'USER',  'User'
        ADMIN = 'ADMIN', 'Admin'

    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email      = models.EmailField(unique=True)
    full_name  = models.CharField(max_length=255)
    role       = models.CharField(max_length=20, choices=Role.choices, default=Role.USER)
    is_active  = models.BooleanField(default=True)
    is_staff   = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD  = 'email'
    REQUIRED_FIELDS = ['full_name']
    objects = UserManager()

    class Meta:
        db_table = 'users'
        verbose_name = 'User'

    def __str__(self):
        return f"{self.full_name} ({self.email})"


class AppModule(models.Model):
    code = models.SlugField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class UserModuleAccess(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='module_access_grants',
    )
    subject_user_id_snapshot = models.UUIDField()
    subject_email_snapshot = models.EmailField(max_length=254)
    subject_name_snapshot = models.CharField(max_length=255)
    module = models.ForeignKey(
        AppModule, on_delete=models.PROTECT, related_name='user_grants'
    )
    granted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='module_access_grants_issued',
    )
    grantor_id_snapshot = models.UUIDField(null=True, blank=True)
    grantor_email_snapshot = models.EmailField(max_length=254, null=True, blank=True)
    grantor_name_snapshot = models.CharField(max_length=255, null=True, blank=True)
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='module_access_grants_revoked',
    )
    revoker_id_snapshot = models.UUIDField(null=True, blank=True)
    revoker_email_snapshot = models.EmailField(max_length=254, null=True, blank=True)
    revoker_name_snapshot = models.CharField(max_length=255, null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['user__email', 'module__code', '-granted_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'module'],
                condition=models.Q(revoked_at__isnull=True),
                name='unique_active_user_module_access',
            )
        ]

    def __str__(self):
        state = 'active' if self.revoked_at is None else 'revoked'
        return f"{self.subject_email_snapshot} — {self.module.code} ({state})"

    def save(self, *args, **kwargs):
        snapshot_fields = []
        if self.user_id and not self.subject_email_snapshot:
            subject = self.user
            self.subject_user_id_snapshot = self.user_id
            self.subject_email_snapshot = subject.email
            self.subject_name_snapshot = subject.full_name
            snapshot_fields.extend([
                'subject_user_id_snapshot',
                'subject_email_snapshot',
                'subject_name_snapshot',
            ])

        if self.granted_by_id and not self.grantor_id_snapshot:
            grantor = self.granted_by
            self.grantor_id_snapshot = self.granted_by_id
            self.grantor_email_snapshot = grantor.email
            self.grantor_name_snapshot = grantor.full_name
            snapshot_fields.extend([
                'grantor_id_snapshot', 'grantor_email_snapshot', 'grantor_name_snapshot'
            ])

        if self.revoked_by_id and not self.revoker_id_snapshot:
            revoker = self.revoked_by
            self.revoker_id_snapshot = self.revoked_by_id
            self.revoker_email_snapshot = revoker.email
            self.revoker_name_snapshot = revoker.full_name
            snapshot_fields.extend([
                'revoker_id_snapshot', 'revoker_email_snapshot', 'revoker_name_snapshot'
            ])

        update_fields = kwargs.get('update_fields')
        if update_fields is not None and snapshot_fields:
            kwargs['update_fields'] = set(update_fields) | set(snapshot_fields)
        super().save(*args, **kwargs)
