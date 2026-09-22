from unittest.mock import patch
from unittest.mock import AsyncMock

from django.test import SimpleTestCase

from TacticalCollaboration import events


class TacticalRealtimeTests(SimpleTestCase):
    def test_publish_event_uses_optional_channel_layer(self):
        publisher = events.get_event_publisher()
        with patch.object(publisher, 'publish') as publish:
            events.publish_state_event(42, 9)
        publish.assert_called_once_with(42, 9)

    def test_version_cursor_rejects_older_events(self):
        self.assertTrue(events.accept_state_version(3, 4))
        self.assertFalse(events.accept_state_version(4, 4))
        self.assertFalse(events.accept_state_version(5, 4))

    def test_local_publisher_delivers_to_organization_group(self):
        publisher = events.LocalEventPublisher()
        layer = type('Layer', (), {'group_send': AsyncMock()})()
        publisher.channel_layer = layer
        publisher.publish(42, 9)
        layer.group_send.assert_awaited_once_with(
            'tactical-org-42', {'type': 'tactical.state_event', 'state_version': 9}
        )

    def test_publisher_uses_configured_channel_layer(self):
        layer = object()
        with patch('TacticalCollaboration.events.get_channel_layer', return_value=layer):
            self.assertIs(events.LocalEventPublisher().channel_layer, layer)
