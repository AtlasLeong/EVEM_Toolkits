import test from 'node:test'
import assert from 'node:assert/strict'
import { pageTransitionKey } from '../../src/utils/routeTransition.js'

test('killboard detail paths share one page transition key', () => {
  assert.equal(pageTransitionKey('/killboard'), '/killboard')
  assert.equal(pageTransitionKey('/killboard/20051112'), '/killboard')
  assert.equal(pageTransitionKey('/killboard/20051113'), '/killboard')
  assert.equal(pageTransitionKey('/killboard/admin'), '/killboard/admin')
  assert.equal(pageTransitionKey('/market'), '/market')
})
