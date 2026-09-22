from unittest.mock import patch

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
