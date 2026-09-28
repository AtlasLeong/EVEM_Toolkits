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
    """Build the legacy direct 19 -> [71, nested bytes] response envelope."""
    nested = msgpack.packb({"kill_blob": blob}, use_bin_type=True)
    envelope = msgpack.packb([71, nested], use_bin_type=True)
    return msgpack.packb(msgpack.ExtType(19, envelope), use_bin_type=True)


def _real_response(blob, **summary):
    """Build the captured Ext10 -> Ext19 -> [71, nested map] response."""
    nested = msgpack.packb({**summary, "kill_blob": blob}, use_bin_type=True)
    inner = msgpack.packb([71, nested], use_bin_type=True)
    transport = msgpack.packb(msgpack.ExtType(19, inner), use_bin_type=True)
    return msgpack.packb(msgpack.ExtType(10, transport), use_bin_type=True)


class KillProtocolTests(unittest.TestCase):
    def test_unwraps_verified_get_kill_info_extension_envelope(self):
        blob = b'<kill killID="19748417" />'

        result = decode_kill_info_response(_response(blob))

        self.assertEqual(result, {"kill_blob": blob})

    def test_unwraps_captured_transport_extension_and_summary_map(self):
        blob = "<attackers><a t=\"0.0\" d=100/></attackers>"
        result = decode_kill_info_response(
            _real_response(blob, kill_id=19748417, victim_ship_type_id=9001)
        )

        self.assertEqual(result["kill_blob"], blob)
        self.assertEqual(result["kill_id"], 19748417)
        self.assertEqual(result["victim_ship_type_id"], 9001)

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

    def test_unwraps_outer_extension_and_nested_report_summary(self):
        blob = '<attackers><a c="9" r="7" a="8" s="123" w="456" d="100" /></attackers>'

        result = decode_kill_info_response(
            _real_response(blob, kill_id=19748417, final_character_id=9)
        )

        self.assertEqual(result["kill_id"], 19748417)
        self.assertEqual(result["kill_blob"], blob)
        self.assertEqual(result["final_character_id"], 9)


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

    def test_parses_captured_sections_and_short_attributes_with_outer_summary(self):
        blob = (
            '<attackers>'
            '<a t="0.0" c=101 r=201 a=301 s=401 w=501 d=100/>'
            '<a t="0.0" s=402 w=502 d=80/>'
            '</attackers>'
            '<items>'
            '<i t=601 f=12 d=2 x=0 c=0 k=999 i_=0 pf=0 s=0/>'
            '<i t=602 f=20 d=0 x=1 c=5 k=1000 i_=0 pf=0 s=0/>'
            '</items>'
            '<other><o data=-3.0 isk_ship=1.0/></other>'
        )
        summary = {
            "kill_id": 19748417,
            "solar_system_id": 30000299,
            "victim_character_id": 42,
            "victim_corporation_id": 7,
            "victim_alliance_id": 8,
            "victim_ship_type_id": 9001,
            "kill_time": "2026-08-15T06:43:05",
            "isk_lost": 229307984742,
            "final_character_id": 101,
            "final_corporation_id": 201,
            "final_alliance_id": 301,
            "final_ship_type_id": 401,
            "final_weapon_type_id": 501,
            "final_damage_done": 100,
        }

        result = parse_kill_blob(blob, summary=summary)

        self.assertEqual(result["kill_id"], 19748417)
        self.assertEqual(result["ship_type_id"], 9001)
        self.assertEqual(result["system_id"], 30000299)
        self.assertEqual(result["victim_character_id"], 42)
        self.assertEqual(result["final_character_id"], 101)
        self.assertIsNone(result["participant_count"])
        self.assertEqual(result["participant_count_source"], "unknown")
        self.assertEqual(result["participants"][0]["character_id"], 101)
        self.assertEqual(result["participants"][0]["corporation_id"], 201)
        self.assertEqual(result["participants"][0]["alliance_id"], 301)
        self.assertEqual(result["participants"][0]["damage"], 100)
        self.assertIsNone(result["participants"][0]["damage_pct"])
        self.assertEqual(result["participants"][0]["ship_type_id"], 401)
        self.assertEqual(result["participants"][0]["weapon_type_id"], 501)
        self.assertEqual(result["items"][0]["type_id"], 601)
        self.assertEqual(result["items"][0]["slot"], "12")
        self.assertEqual(result["items"][0]["status"], "dropped")
        self.assertEqual(result["items"][1]["quantity_unknown"], 5)
        self.assertEqual(result["items"][1]["status"], "destroyed")

    def test_captured_blob_without_attackers_keeps_summary_identity_and_unknown_count(self):
        result = parse_kill_blob(
            '<other><o data=-3.0 isk_ship=1.0/></other>',
            summary={
                "kill_id": 19748418,
                "victim_ship_type_id": 9002,
                "final_character_id": 11,
                "final_corporation_id": 12,
                "final_alliance_id": 13,
                "final_ship_type_id": 9003,
                "final_weapon_type_id": 9004,
                "final_damage_done": 136648,
                "kill_time": "2026-08-15T06:43:22",
            },
        )

        self.assertEqual(result["kill_id"], 19748418)
        self.assertEqual(result["final_character_id"], 11)
        self.assertEqual(result["participant_count"], None)
        self.assertEqual(result["participant_count_source"], "unknown")
        self.assertEqual(result["participants"][0]["character_id"], 11)
        self.assertTrue(result["participants"][0]["is_final_blow"])
        self.assertEqual(result["equipment_status"], "missing")

    def test_missing_equipment_block_is_explicit_not_empty_drop_result(self):
        result = parse_kill_blob(
            '<kill killID="19748418" killTime="2026-08-15T06:43:22">'
            '<attackers count="1"><attacker characterID="10" /></attackers>'
            '</kill>'
        )

        self.assertEqual(result["equipment_status"], "missing")
        self.assertEqual(result["items"], [])

    def test_parses_real_parallel_sections_and_short_item_fields(self):
        blob = (
            '<attackers><a c="9" r="7" a="8" s="123" w="456" d="100" t="0.0" />'
            '<a c="10" d="80" /></attackers>'
            '<items><i t="100" f="low" d="1" x="0" c="5" /></items>'
            '<other data="opaque" />'
        )

        result = parse_kill_blob(
            blob,
            metadata={
                "kill_id": 19748417,
                "solar_system_id": 30000299,
                "victim_character_id": 42,
                "kill_time": "2026-08-15T06:43:05",
                "isk_lost": "229307984742.00",
                "final_character_id": 9,
                "final_damage_done": 100,
            },
        )

        self.assertEqual(result["kill_id"], 19748417)
        self.assertEqual(result["system_id"], 30000299)
        self.assertEqual(result["participants"][0]["damage"], 100)
        self.assertTrue(result["participants"][0]["is_final_blow"])
        self.assertEqual(result["participants"][1]["damage_pct"], None)
        self.assertEqual(result["items"][0]["type_id"], 100)
        self.assertEqual(result["items"][0]["slot"], "low")
        self.assertEqual(result["items"][0]["quantity_unknown"], 5)
        self.assertEqual(result["equipment_status"], "provided")

    def test_summary_can_supply_last_hit_without_attacker_rows(self):
        result = parse_kill_blob(
            '<other data="opaque" />',
            metadata={
                "kill_id": 19748418,
                "final_character_id": 99,
                "final_corporation_id": 7,
                "final_damage_done": 136648,
                "kill_time": "2026-08-15T06:43:22",
            },
        )

        self.assertEqual(result["participant_count"], None)
        self.assertEqual(result["participant_count_source"], "unknown")
        self.assertEqual(result["participants"][0]["character_id"], 99)
        self.assertTrue(result["participants"][0]["is_final_blow"])
        self.assertEqual(result["equipment_status"], "missing")

    def test_rejects_duplicate_attributes(self):
        with self.assertRaises(KillParseError):
            parse_kill_blob('<kill killID="1" killID="2" />')

    def test_rejects_invalid_numbers(self):
        with self.assertRaises(KillParseError):
            parse_kill_blob('<kill killID="not-a-number" />')

    def test_captured_summary_rejects_negative_id_and_unknown_sections(self):
        for blob, summary in [
            ('<other/>', {'kill_id': -1}),
            ('<script/>', {'kill_id': 1}),
            ('<items/><items/>', {'kill_id': 1}),
        ]:
            with self.subTest(blob=blob), self.assertRaises(KillParseError):
                parse_kill_blob(blob, summary=summary)

    def test_partial_attackers_do_not_claim_global_top_damage(self):
        parsed = parse_kill_blob('<attackers><a c=10 d=100/></attackers>', summary={'kill_id': 100, 'final_character_id': 11})
        self.assertFalse(any(p['is_top_damage'] for p in parsed['participants']))
        self.assertTrue(any(p['is_final_blow'] and p['character_id'] == 11 for p in parsed['participants']))

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
