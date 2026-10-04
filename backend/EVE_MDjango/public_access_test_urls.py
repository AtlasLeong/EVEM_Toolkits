"""Production route handlers under the isolated public-access test settings."""

from django.urls import include, path
from rest_framework.response import Response
from rest_framework.views import APIView

from .ci_urls import urlpatterns as application_patterns


class FuturePrivateAPI(APIView):
    """A new view with no explicit permission must inherit the authenticated default."""

    def get(self, request):
        return Response({'identity': request.user.pk})

    def post(self, request):
        raise AssertionError('An anonymous request must not invoke this handler.')


urlpatterns = [
    *application_patterns,
    path('api/', include('StarFieldSearch.urls')),
    path('api/', include('PlanetaryResource.urls')),
    path('api/', include('Bazaar.urls')),
    path('api/', include('FraudList.urls')),
    path('api/future-private/', FuturePrivateAPI.as_view()),
]
