from django.urls import include, path
from .deployment import deployment_version

urlpatterns = [
    path('api/feedback/', include('Feedback.urls')),
    path('api/deploy-version/', deployment_version, name='deployment_version'),
    path('api/license/', include('License.urls')),
    path('api/activationcode/', include('ActivationCode.urls')),
]
