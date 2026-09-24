import test from 'node:test'
import assert from 'node:assert/strict'
import { BOARD_KINDS, boardsForOrganization, createBoardAttemptSignature, selectTacticalBoard } from '../../src/utils/tacticalBoards.js'

const boards = [
  { id: 11, name: '主战区', kind: 'war' },
  { id: 12, name: '巡猎线索', kind: 'pirate' },
  { id: 13, name: '预备战区', kind: 'war' },
]

test('board choices are distinct icon-and-text concepts', () => {
  assert.deepEqual(BOARD_KINDS.map(({ kind, label }) => [kind, label]), [
    ['war', '战争沙盘板'],
    ['pirate', '海盗情报板'],
  ])
  assert.ok(BOARD_KINDS.every((item) => item.description.length > 0))
})

test('an explicit board deep link wins only within the selected organization', () => {
  assert.equal(selectTacticalBoard(boards, '13')?.id, 13)
  assert.equal(selectTacticalBoard(boards, '999')?.id, 11)
})

test('a pirate-first organization selects its actual first board', () => {
  assert.equal(selectTacticalBoard([{ id: 21, name: '猎物', kind: 'pirate' }])?.id, 21)
  assert.equal(selectTacticalBoard([]), null)
})

test('old organization lists remain a single legacy war board during rollout', () => {
  assert.deepEqual(boardsForOrganization({ id: 8, name: '旧组织' }), [
    { id: null, name: '战争沙盘板', kind: 'war', is_default: true },
  ])
  assert.deepEqual(boardsForOrganization({ id: 8, boards: [] }), [])
})

test('switching initial board type changes the idempotent create signature', () => {
  assert.notEqual(
    createBoardAttemptSignature('create', '北境', 'war'),
    createBoardAttemptSignature('create', '北境', 'pirate'),
  )
  assert.equal(createBoardAttemptSignature('join', ' abc ', 'war'), createBoardAttemptSignature('join', 'abc', 'pirate'))
})
