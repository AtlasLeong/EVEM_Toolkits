from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from Authentication.permissions import IsAllowlistedViewer

from .quality import quality_payload


class PublicQualityView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAllowlistedViewer]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'market_public'

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store, private'
        return response

    def get(self, request):
        return Response(quality_payload())
