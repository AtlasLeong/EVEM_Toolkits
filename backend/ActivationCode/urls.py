# urls.py
from django.urls import path
from . import views
from .views import GenerateActivationCode, ValidateActivationCode

urlpatterns = [
    path('generate-code/', GenerateActivationCode.as_view(), name='generate_code'),
    path('validate-code/', ValidateActivationCode.as_view(), name='validate_code'),
]

