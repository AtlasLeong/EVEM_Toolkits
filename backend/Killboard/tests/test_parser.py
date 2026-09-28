"""Red/green tests for the bounded killboard protocol and detail parser."""

from decimal import Decimal
import unittest
from unittest.mock import patch

import msgpack

from Killboard.parser import KillParseError, parse_kill_blob
from Killboard.protocol import (
    MAX_ARRAY_ITEMS,
    KillProtocolError,
    decode_kill_info_response,
)


def _response(blob):
    """Build the verified 19 -> [71, nested bytes] response envelope."""
    nested = msgpack.packb({"kill_blob": blob}, use_bin_type=True)
    envelope = msgpack.packb([71, nested], use_bin_type=True)
    return msgpack.packb(msgpack.ExtType(19, envelope), use_bin_type=True)


class KillProtocolTests(unittest.TestCase):
    def test_unwraps_verified_get_kill_info_extension_envelope(self):
        blob = b'<kill killID="19748417" />'

        result = decode_kill_info_response(_response(blob))

        self.assertEqual(result, {"kill_blob": blob})

    def test_empty_response_is_none(self):
        self.assertIsNone(decode_kill_info_response(msgpack.packb(None, use_bin_type=True)))
        self.assertIsNone(decode_kill_info_response(msgpack.packb([], use_bin_type=True)))

    def test_unpacker_applies_container_limits_before_materializing(self):
        payload = msgpack.packb([0] * (MAX_ARRAY_ITEMS + 1), use_bin_type=True)

        with patch("Killboard.protocol.msgpack.unpackb", wraps=msgpack.unpackb) as unpack:
            with self.assertRaises(KillProtocolError):
                decode_kill_info_response(payload)

        self.assertTrue(unpack.call_args_list)
        for call in unpack.call_args_list:
            self.assertEqual(call.kwargs["max_array_len"], MAX_ARRAY_ITEMS)


class KillBlobParserTests(unittest.TestCase):
    def test_parses_report_participants_and_d_x_c_equipment_fields(self):
        blob = """
            <kill killID="19748417" shipTypeID="123" shipName="Vassago"
                solarSystemID="30000299" solarSystemName="Test System"
                killTime="2026-08-15T06:43:05" iskLost="229307984742.00"
                participantCount="2">
              <victim characterID="42" characterName="Victim" corporationID="7"
                corporationName="Corp" />
              <attackers>
                <attacker characterID="9" characterName="Pilot" damageDone="100"
                  damagePercent="55.5" finalBlow="1" topDamage="1" />
                <attacker characterID="10" characterName="Scout" damageDone="80"
                  damagePercent="44.5" />
              </attackers>
              <items>
                <item typeID="100" typeName="Dropped module" slot="low" d="2" x="0" c="1" />
                <item typeID="101" typeName="Destroyed module" slot="mid" d="0" x="3" />
              </items>
            </kill>
        """

        result = parse_kill_blob(blob)

        self.assertEqual(result["kill_id"], 19748417)
        self.assertEqual(result["ship_type_id"], 123)
        self.assertEqual(result["victim_character_id"], 42)
        self.assertEqual(result["participant_count"], 2)
        self.assertEqual(result["participants"][0]["damage"], 100)
        self.assertTrue(result["participants"][0]["is_final_blow"])
        self.assertTrue(result["participants"][0]["is_top_damage"])
        self.assertEqual(result["items"][0]["quantity_dropped"], 2)
        self.assertEqual(result["items"][0]["quantity_destroyed"], 0)
        self.assertEqual(result["items"][0]["quantity_unknown"], 1)
        self.assertEqual(result["items"][0]["status"], "dropped")
        self.assertEqual(result["items"][1]["status"], "destroyed")
        self.assertEqual(result["kill_time_raw"], "2026-08-15T06:43:05")
        self.assertEqual(result["time_quality"], "unknown")
        self.assertEqual(result["isk_lost"], Decimal("229307984742.00"))

    def test_missing_equipment_block_is_explicit_not_empty_drop_result(self):
        result = parse_kill_blob(
            '<kill killID="19748418" killTime="2026-08-15T06:43:22">'
            '<attackers count="1"><attacker characterID="10" /></attackers>'
            '</kill>'
        )

        self.assertEqual(result["equipment_status"], "missing")
        self.assertEqual(result["items"], [])

    def test_rejects_duplicate_attributes(self):
        with self.assertRaises(KillParseError):
            parse_kill_blob('<kill killID="1" killID="2" />')

    def test_rejects_invalid_numbers(self):
        with self.assertRaises(KillParseError):
            parse_kill_blob('<kill killID="not-a-number" />')

    def test_rejects_control_characters(self):
        with self.assertRaises(KillParseError):
            parse_kill_blob('<kill killID="1" shipName="bad\x01value" />')

    def test_rejects_entities_in_attribute_values(self):
        with self.assertRaises(KillParseError):
            parse_kill_blob('<kill killID="1" shipName="A&amp;B" />')

    def test_rejects_oversized_blob(self):
        with self.assertRaises(KillParseError):
            parse_kill_blob('<kill killID="1" shipName="x" />' + (' ' * 1_100_000))

    def test_rejects_excessive_nodes_attributes_and_depth(self):
        many_nodes = '<kill killID="1">' + ('<i />' * 10_001) + '</kill>'
        with self.assertRaises(KillParseError):
            parse_kill_blob(many_nodes)

        attrs = ' '.join(f'a{index}="1"' for index in range(65))
        with self.assertRaises(KillParseError):
            parse_kill_blob(f'<kill killID="1" {attrs} />')

        nested = '<kill killID="1">' + ('<x>' * 33) + ('</x>' * 33) + '</kill>'
        with self.assertRaises(KillParseError):
            parse_kill_blob(nested)
