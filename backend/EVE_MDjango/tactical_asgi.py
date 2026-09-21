"""Opt-in ASGI entry. Existing WSGI deployment is intentionally unchanged."""
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'EVE_MDjango.settings')

from django.core.asgi import get_asgi_application

http_application = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from django.urls import re_path
from TacticalCollaboration.realtime import TacticalConsumer

application = ProtocolTypeRouter({
    'http': http_application,
    'websocket': URLRouter([
        re_path(r'^ws/tactical/(?P<organization_id>\d+)/$', TacticalConsumer.as_asgi()),
    ]),
})
