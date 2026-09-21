from io import BytesIO
from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from . import graph, services


class BoundedJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        payload = stream.read(65537)
        if len(payload) > 65536:
            raise ParseError('请求内容过大。')
        try:
            return super().parse(BytesIO(payload), media_type, parser_context)
        except RecursionError:
            raise ParseError('请求内容嵌套过深。')


class PrivateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [BoundedJSONParser]

    def handle_exception(self, exc):
        response = super().handle_exception(exc)
        if isinstance(response.data, dict) and 'detail' in response.data:
            response.data['code'] = getattr(response.data['detail'], 'code', 'invalid')
        return response

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store, private'
        return response


class Organizations(PrivateView):
    def get(self, request):
        return Response(services.list_organizations(request.user))

    def post(self, request):
        return Response({'ok': True, 'result': services.create_organization(request.user, request.data)})


class Join(PrivateView):
    def post(self, request):
        return Response({'ok': True, 'result': services.join_organization(request.user, request.data)})


class Members(PrivateView):
    def get(self, request, organization_id):
        return Response(services.members(request.user, organization_id))


class Commands(PrivateView):
    def post(self, request, organization_id):
        return Response({'ok': True, 'result': services.command(request.user, organization_id, request.data)})


class Presence(PrivateView):
    def post(self, request, organization_id):
        services.fields(request.data, ('connection_id',))
        return Response(services.admit(request.user, organization_id, request.data['connection_id']))

    def delete(self, request, organization_id):
        services.fields(request.data, ('connection_id',))
        return Response(services.leave(request.user, organization_id, request.data['connection_id']))


class Snapshot(PrivateView):
    def get(self, request, organization_id):
        return Response(services.snapshot(request.user, organization_id, request.query_params.get('connection_id')))


class Map(PrivateView):
    def get(self, request, organization_id):
        return Response(graph.map_data(request.user, organization_id))


class Catalog(PrivateView):
    def get(self, request, organization_id):
        return Response(graph.catalog(request.user, organization_id, request.query_params.get('kind'), request.query_params.get('q', '')))
