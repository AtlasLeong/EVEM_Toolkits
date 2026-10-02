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
    def test_anonymous_final_summary_matches_unique_verified_source_row(self):
        parsed = parse_kill_blob(
            '<attackers><a s=10500000601 w=11004320024 d=384191 cf=500019 fs=3141.37/></attackers>',
            summary={'kill_id': 19748417, 'final_character_id': None,
                     'final_ship_type_id': 10500000601, 'final_weapon_type_id': 11004320024,
                     'final_damage_done': 384191, 'killer_camouflaged_faction_id': 500019,
                     'killer_feat_score': 3141.37, 'victim_damage_taken': 2283208},
        )
        self.assertEqual(len(parsed['participants']), 1)
        self.assertTrue(parsed['participants'][0]['is_final_blow'])
        self.assertEqual(parsed['participants'][0]['camouflaged_faction_id'], 500019)
        self.assertEqual(parsed['participants'][0]['feat_score'], Decimal('3141.37'))
        self.assertEqual(parsed['participants'][0]['damage_pct'], Decimal('16'))
        self.assertEqual(parsed['final_summary']['match_status'], 'matched')
        self.assertFalse(parsed['damage_total_verified'])
        self.assertFalse(parsed['participants'][0]['is_top_damage'])

    def test_missing_anonymous_final_is_preserved_and_reconciles_complete_damage(self):
        parsed = parse_kill_blob(
            '<attackers><a s=55900003010 d=239106/><a s=10500003211 d=461421/></attackers>',
            summary={'kill_id': 20043145, 'final_character_id': None,
                     'final_ship_type_id': 55900003010, 'final_damage_done': 293464,
                     'victim_damage_taken': 993991},
        )
        self.assertEqual(len(parsed['participants']), 3)
        final = parsed['participants'][-1]
        self.assertTrue(final['is_final_blow'])
        self.assertTrue(final['is_source_summary'])
        self.assertEqual(final['damage'], 293464)
        self.assertEqual(final['damage_pct'], Decimal('29'))
        self.assertEqual(parsed['final_summary']['match_status'], 'added')
        self.assertTrue(parsed['damage_total_verified'])
        self.assertTrue(parsed['participants'][1]['is_top_damage'])
        self.assertFalse(final['is_top_damage'])

    def test_one_source_row_can_be_both_final_and_top_when_damage_is_complete(self):
        parsed = parse_kill_blob('<attackers><a c=7 s=8 w=9 d=100/></attackers>',
                                 summary={'kill_id': 101, 'final_character_id': 7,
                                          'final_ship_type_id': 8, 'final_weapon_type_id': 9,
                                          'final_damage_done': 100, 'victim_damage_taken': 100})
        row = parsed['participants'][0]
        self.assertTrue(row['is_final_blow'])
        self.assertTrue(row['is_top_damage'])
        self.assertEqual(parsed['participant_count'], 1)
        self.assertEqual(parsed['participant_count_source'], 'damage_reconciled')

    def test_ambiguous_final_summary_never_marks_arbitrary_row_or_duplicates_damage(self):
        parsed = parse_kill_blob('<attackers><a s=8 w=9 d=100/><a s=8 w=9 d=100/></attackers>',
                                 summary={'kill_id': 102, 'final_ship_type_id': 8,
                                          'final_weapon_type_id': 9, 'final_damage_done': 100,
                                          'victim_damage_taken': 200})
        self.assertEqual(len(parsed['participants']), 2)
        self.assertFalse(any(p['is_final_blow'] for p in parsed['participants']))
        self.assertEqual(parsed['final_summary']['match_status'], 'ambiguous')
        self.assertFalse(parsed['damage_total_verified'])
        self.assertFalse(any(p['is_top_damage'] for p in parsed['participants']))

    def test_partial_damage_and_missing_damage_do_not_claim_top_record(self):
        for blob, total in [('<attackers><a c=7 d=100/></attackers>', 200),
                            ('<attackers><a c=7 d=100/><a c=8/></attackers>', 100)]:
            parsed = parse_kill_blob(blob, summary={'kill_id': 103, 'victim_damage_taken': total})
            self.assertFalse(parsed['damage_total_verified'])
            self.assertFalse(any(p['is_top_damage'] for p in parsed['participants']))

    def test_empty_final_fields_are_not_a_fake_final_attacker(self):
        parsed = parse_kill_blob('<attackers><a c=7 d=100/></attackers>',
                                 summary={'kill_id': 104, 'final_character_id': None,
                                          'final_ship_type_id': None, 'final_damage_done': None})
        self.assertEqual(len(parsed['participants']), 1)
        self.assertEqual(parsed['final_summary'], {})

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

    def test_enriches_compact_ids_from_verified_identity_maps(self):
        blob = (
            '<attackers>'
            '<a c="101" r="201" a="301" s="401" w="501" d="100"/>'
            '</attackers>'
        )
        identity = {
            "characters": {
                101: {
                    "name": "刀功料理",
                    "corporation_id": 201,
                    "alliance_id": 301,
                },
                42: {
                    "name": "三天没挨打",
                    "corporation_id": 202,
                    "alliance_id": 302,
                },
            },
            "corporations": {
                201: {"name": "罗德骑士团", "ticker": "KOFR"},
                202: {"name": "双子王的暗卫喵", "ticker": "GCG1"},
            },
            "alliances": {
                301: {"name": "联盟一"},
                302: {"name": "联盟二"},
            },
        }

        result = parse_kill_blob(
            blob,
            summary={
                "kill_id": 19748417,
                "victim_character_id": 42,
                "victim_corporation_id": 202,
                "victim_alliance_id": 302,
            },
            identity_map=identity,
        )

        participant = result["participants"][0]
        self.assertEqual(participant["character_name"], "刀功料理")
        self.assertEqual(participant["corporation_name"], "罗德骑士团")
        self.assertEqual(participant.get("corporation_ticker"), "KOFR")
        self.assertEqual(participant["alliance_name"], "联盟一")
        self.assertEqual(result["victim_name"], "三天没挨打")
        self.assertEqual(result["victim_corporation_name"], "双子王的暗卫喵")
        self.assertEqual(result.get("victim_corporation_ticker"), "GCG1")
        self.assertEqual(result["victim_alliance_name"], "联盟二")

    def test_missing_verified_tickers_are_blank_not_derived_from_corporation_names(self):
        for identity in (None, {}, {"corporations": {201: "Some English Corp", 202: {"name": "双子王"}}}):
            with self.subTest(identity=identity):
                result = parse_kill_blob(
                    '<attackers><a c=101 r=201 d=100/></attackers>',
                    summary={"kill_id": 19748417, "victim_character_id": 42,
                             "victim_corporation_id": 202},
                    identity_map=identity,
                )
                self.assertEqual(result.get("victim_corporation_ticker"), "")
                self.assertEqual(result["participants"][0].get("corporation_ticker"), "")

    def test_final_summary_participant_gets_verified_corporation_ticker(self):
        result = parse_kill_blob(
            '<other data="opaque"/>',
            summary={"kill_id": 19748418, "final_character_id": 101,
                     "final_corporation_id": 201},
            identity_map={"corporations": {201: {"name": "罗德骑士团", "ticker": "KOFR"}}},
        )
        self.assertEqual(result["participants"][0].get("corporation_ticker"), "KOFR")

    def test_malformed_or_oversized_corporation_tickers_are_absent_not_truncated(self):
        for ticker in (None, 123, {}, ['TAG'], 'X' * 256):
            with self.subTest(ticker_type=type(ticker).__name__):
                result = parse_kill_blob(
                    '<attackers><a c=101 r=201 d=100/></attackers>',
                    summary={"kill_id": 19748417, "victim_corporation_id": 202},
                    identity_map={"corporations": {
                        201: {"name": "罗德骑士团", "ticker": ticker},
                        202: {"name": "双子王的暗卫喵", "ticker": ticker},
                    }},
                )
                self.assertEqual(result["victim_corporation_ticker"], "")
                self.assertEqual(result["participants"][0]["corporation_ticker"], "")

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
