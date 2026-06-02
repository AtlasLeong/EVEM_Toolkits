from django.urls import path

from .views import (
    GenerateLicenseActivationCode,
    LicenseActivationCodeDetail,
    LicenseActivationCodeExtend,
    LicenseActivationCodeExtraScripts,
    LicenseActivationCodeListCreate,
    LicenseActivationCodeUnbind,
    ValidateLicenseActivationCode,
)


urlpatterns = [
    path('generate-code/', GenerateLicenseActivationCode.as_view(), name='license_generate_code'),
    path('validate-code/', ValidateLicenseActivationCode.as_view(), name='license_validate_code'),
    path('codes/', LicenseActivationCodeListCreate.as_view(), name='license_code_list'),
    path('codes/<int:pk>/', LicenseActivationCodeDetail.as_view(), name='license_code_detail'),
    path('codes/<int:pk>/unbind/', LicenseActivationCodeUnbind.as_view(), name='license_code_unbind'),
    path('codes/<int:pk>/extend/', LicenseActivationCodeExtend.as_view(), name='license_code_extend'),
    path('codes/<int:pk>/extra-scripts/', LicenseActivationCodeExtraScripts.as_view(), name='license_code_extra_scripts'),
]
