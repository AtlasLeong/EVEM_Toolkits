"""Shared private headers and bounded query parsing, without model imports."""
import re
from django.utils.cache import patch_vary_headers
from django.db import DatabaseError
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.response import Response

MAX_INTEGER = 9007199254740991


def private_headers(response):
    response['Cache-Control'] = 'private, no-store'
    patch_vary_headers(response, ['Authorization'])
    return response


class PrivateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'control_center'
    http_method_names = ['get', 'head', 'options']

    def finalize_response(self, request, response, *args, **kwargs):
        return private_headers(super().finalize_response(request, response, *args, **kwargs))

    def handle_exception(self, exc):
        if isinstance(exc, DatabaseError):
            return Response({'detail': '服务暂时不可用，请稍后重试。'}, status=503)
        return super().handle_exception(exc)


def query_values(request, allowed):
    query = request.query_params
    if set(query) - set(allowed) or any(len(query.getlist(key)) != 1 for key in query):
        raise ValidationError({'detail': '查询参数无效。'})
    return query


def integer(value, *, minimum=0, maximum=MAX_INTEGER):
    if not isinstance(value, str) or not re.fullmatch(r'(?:0|[1-9][0-9]{0,15})', value, flags=re.ASCII):
        raise ValidationError({'detail': '查询参数无效。'})
    result = int(value)
    if not minimum <= result <= maximum:
        raise ValidationError({'detail': '查询参数无效。'})
    return result
