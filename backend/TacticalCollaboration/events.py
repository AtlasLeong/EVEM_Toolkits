"""Post-commit organization state events delivered through the Channels layer."""
import logging
from asgiref.sync import async_to_sync
try:
    from channels.layers import get_channel_layer, InMemoryChannelLayer
except ImportError:  # Optional event delivery when Channels is not installed.
    get_channel_layer = lambda: None
    InMemoryChannelLayer = None

logger = logging.getLogger(__name__)
_publisher = None


class LocalEventPublisher:
    def __init__(self):
        self.channel_layer = self._build_layer()

    @staticmethod
    def _build_layer():
        return get_channel_layer() or (InMemoryChannelLayer() if InMemoryChannelLayer else None)

    def publish(self, organization_id, state_version):
        if self.channel_layer is None:
            return None
        try:
            async_to_sync(self.channel_layer.group_send)(
                f'tactical-org-{organization_id}',
                {'type': 'tactical.state_event', 'state_version': state_version},
            )
        except Exception:
            # Persistence is authoritative. A transient broker failure must not
            # turn a committed command into a 500; clients recover via HTTP.
            logger.warning('Tactical event delivery temporarily unavailable for organization %s', organization_id)
        return None


def get_event_publisher():
    global _publisher
    if _publisher is None:
        _publisher = LocalEventPublisher()
    return _publisher


def publish_state_event(organization_id, state_version):
    return get_event_publisher().publish(organization_id, state_version)


def accept_state_version(current, incoming):
    return incoming > current
