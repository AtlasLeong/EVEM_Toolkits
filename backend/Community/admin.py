from django.contrib import admin
from .models import Claim, Corporation, DraftRequest, MediaAsset, Revision


class ReadOnlyCommunityAdmin(admin.ModelAdmin):
    """Moderation must use the locked, audited API rather than bypass state rules."""
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


for model in (Corporation, Claim, Revision, DraftRequest, MediaAsset):
    admin.site.register(model, ReadOnlyCommunityAdmin)
