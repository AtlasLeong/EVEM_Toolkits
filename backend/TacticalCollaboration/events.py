"""Optional post-commit state events; HTTP polling remains the local fallback."""
import logging

logger = logging.getLogger(__name__)
_publisher = None


class LocalEventPublisher:
    def publish(self, organization_id, state_version):
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
