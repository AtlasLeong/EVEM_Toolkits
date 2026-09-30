# KM NPC identity recovery design

## Goal

Recover the NPC labels shown by the EVE Echoes client for anonymous killmail participants, without guessing from character-ID ranges or turning normal players into NPCs.

## Evidence and decision

The KM participant payload uses `w` as the weapon/unit type ID. The client item catalog contains exact no-icon NPC entries such as `56000171040 -> 科尔`, `56000171030 -> 克尔鲁姆`, and `56000771040 -> 深眠者`. The current parser persists `weapon_type_id` but the serializer never resolves it, which is why the UI shows unknown identities. The ship name and image continue to come from `s` (`ship_type_id`).

## Data flow

1. Keep the raw `weapon_type_id` unchanged as the provenance key.
2. Add a GameData lookup that returns an NPC identity only when the exact client record is marked as a no-icon NPC identity entry; ordinary weapon/module rows remain ordinary equipment.
3. In participant serialization, prefer verified player identity, then verified camouflage identity, then the exact NPC weapon mapping. Set `identity_kind` to `npc` and expose `npc_source_type_id` when the latter is used.
4. Preserve the existing honest fallback for rows with no verified identity.
5. Add focused tests for known NPC weapon IDs, ordinary weapon IDs, and player/camouflage precedence.

## Reprocessing

The production database keeps `raw_hash` but not the original KM blob for reports 20043564 and 20043609. The serializer change makes existing rows render correctly immediately when their persisted `weapon_type_id` is present; rows without that field require a fresh KM capture before they can be backfilled.

## UI

The existing participant row will display the resolved NPC name and retain the ship name/image. No new “限流” state or speculative NPC label is introduced.

## Verification

Run backend Killboard tests, frontend unit tests, and a production read-only API check for reports 20043564/20043609 after deployment. Verify that named players still win over NPC fallback and that ordinary weapon IDs never become NPCs.
