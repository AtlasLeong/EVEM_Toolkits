"""Invented profile envelopes only; no captured identifiers or names."""

import importlib
import unittest

import msgpack

from Killboard.tests.test_session_bundle import pack


def character(identifier=101, name='Synthetic pilot', corporation=201, alliance=301):
    return msgpack.ExtType(58, pack({'character_id': identifier, 'character_name': name,
                                    'corporation_id': corporation, 'alliance_id': alliance,
                                    'create_date': msgpack.ExtType(12, b'opaque timestamp'),
                                    'unknown_field': 'never projected'}))


def corporation(identifier=201, name='Synthetic corporation', alliance=301):
    return msgpack.ExtType(19, pack([2, pack({'corporation_id': identifier,
                                           'corporation_name': name, 'ticker_name': 'TEST',
                                           'alliance_id': alliance, 'alliance_name': 'Synthetic alliance',
                                           'unknown_field': 'never projected'})]))


class IdentityProtocolTests(unittest.TestCase):
    def setUp(self):
        try:
            self.protocol = importlib.import_module('Killboard.identity_protocol')
        except ModuleNotFoundError:
            self.fail('bounded verified profile decoders are missing')

    def test_decodes_verified_batch_character_envelope_and_projects_only_identity(self):
        payload = msgpack.ExtType(10, pack([character()]))
        rows = self.protocol.decode_public_info(payload, [101, 102])
        self.assertEqual(rows, {101: {'name': 'Synthetic pilot', 'corporation_id': 201, 'alliance_id': 301}})
        self.assertNotIn(102, rows)

    def test_decodes_corporation_business_kind_two_and_explicit_alliance_name(self):
        rows = self.protocol.decode_corp_brief([corporation()], [201])
        self.assertEqual(rows, {201: {'name': 'Synthetic corporation', 'ticker': 'TEST',
                                    'alliance_id': 301, 'alliance_name': 'Synthetic alliance'}})

    def test_empty_profile_batch_does_not_invent_names_or_npc_status(self):
        self.assertEqual(self.protocol.decode_public_info([], [101]), {})
        self.assertEqual(self.protocol.decode_corp_brief([], [201]), {})

    def test_rejects_unrequested_duplicate_invalid_identifiers_and_malformed_names(self):
        for rows in ([character(102)], [character(), character()], [character(True)],
                     [character(name='bad\x01name')], [character(name='x' * 257)],
                     [character(corporation=-1)], [msgpack.ExtType(59, pack({}))],
                     [msgpack.ExtType(58, b'private-sensitive-detail')]):
            with self.subTest(count=len(rows)), self.assertRaises(self.protocol.IdentityProtocolError) as caught:
                self.protocol.decode_public_info(rows, [101])
            self.assertNotIn('private-sensitive-detail', str(caught.exception))
        bad = msgpack.ExtType(19, pack([71, pack({'corporation_id': 201})]))
        with self.assertRaises(self.protocol.IdentityProtocolError):
            self.protocol.decode_corp_brief([bad], [201])

    def test_profile_batches_and_binary_are_bounded(self):
        for rows, identifiers in (([character()] * 513, [101]), ([], list(range(1, 514))),
                                  ([], [True]), ([], [101, 101])):
            with self.assertRaises(self.protocol.IdentityProtocolError):
                self.protocol.decode_public_info(rows, identifiers)

    def test_duplicate_profile_map_keys_are_malformed(self):
        data = (b'\x85' + pack('character_id') + pack(101) + pack('character_id') + pack(102)
                + pack('character_name') + pack('Synthetic pilot') + pack('corporation_id') + pack(None)
                + pack('alliance_id') + pack(None))
        with self.assertRaises(self.protocol.IdentityProtocolError):
            self.protocol.decode_public_info([msgpack.ExtType(58, data)], [102])


if __name__ == '__main__':
    unittest.main()
