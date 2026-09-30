import test from 'node:test'
import assert from 'node:assert/strict'
import { participantIdentity, visibleParticipantRows } from '../../src/utils/killboardPresentation.js'

test('verified NPC display labels keep their name and NPC treatment', () => {
  const row = { identity_kind: 'npc', display_name: '科尔', ship_name: '万王宝座级强袭型', damage: 53084 }
  const identity = participantIdentity(row)

  assert.equal(identity.name, '科尔')
  assert.equal(identity.corporation, '非玩家角色')
  assert.equal(identity.isNpc, true)
  assert.deepEqual(visibleParticipantRows([row]), [row])
})

test('participant rows with a hull or ship identity remain visible while aggregate-only rows stay hidden', () => {
  const rows = [
    { character_name: '', ship_type_id: '9001', damage: 2 },
    { character_name: '', damage: 1 },
    ...Array.from({ length: 7 }, (_, index) => ({ character_name: `玩家${index + 1}` })),
  ]

  assert.deepEqual(visibleParticipantRows(rows).map(row => row.character_name), ['', '玩家1', '玩家2', '玩家3', '玩家4', '玩家5', '玩家6'])
})
