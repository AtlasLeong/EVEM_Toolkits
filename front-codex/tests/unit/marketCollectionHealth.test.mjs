import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionPauseLabel, healthAge, healthCoverage, healthCapacityWarning } from '../../src/utils/marketCollectionHealth.js'

test('private collection reasons distinguish evidence from assumptions and never echo unknown text', () => {
  assert.match(collectionPauseLabel('invalid_session'), /材料.*无效/)
  assert.match(collectionPauseLabel('invalid_material'), /材料.*无效/)
  assert.match(collectionPauseLabel('authentication_required'), /尚不能确认/)
  assert.match(collectionPauseLabel('authentication_rejected'), /认证.*拒绝/)
  assert.doesNotMatch(collectionPauseLabel('invalid_session'), /已过期/)
  assert.match(collectionPauseLabel('auth_rejected'), /认证.*拒绝/)
  assert.match(collectionPauseLabel('rate_limited'), /冷却/)
  assert.match(collectionPauseLabel('service_rejected'), /服务拒绝/)
  assert.match(collectionPauseLabel('account_busy'), /占用/)
  assert.match(collectionPauseLabel('budget_exhausted'), /额度/)
  assert.match(collectionPauseLabel('timeout'), /超时/)
  assert.equal(collectionPauseLabel('/private/session-secret.json'), '原因尚未确认')
  assert.equal(collectionPauseLabel('constructor'), '原因尚未确认')
  assert.equal(collectionPauseLabel('__proto__'), '原因尚未确认')
})

test('unknown age and zero-denominator coverage are not presented as a fresh zero', () => {
  assert.equal(healthAge(null), '未知')
  assert.equal(healthAge(-1), '未知')
  assert.equal(healthAge(Infinity), '未知')
  assert.equal(healthAge(0), '不到 1 分钟')
  assert.equal(healthAge(90_000), '1 分钟')
  assert.equal(healthAge(7_260_000), '2 小时 1 分钟')
  assert.equal(healthCoverage(0, 0), '暂无启用商品')
  assert.equal(healthCoverage(1, 4), '1 / 4（25.0%）')
  assert.equal(healthCoverage(null, 4), '未知')
  assert.equal(healthCoverage(5, 4), '未知')
})

test('capacity warnings only use a fixed private label whitelist', () => {
  assert.match(healthCapacityWarning('priority_target_infeasible'), /重点/)
  assert.match(healthCapacityWarning('ordinary_target_infeasible'), /普通/)
  assert.equal(healthCapacityWarning('private-error-token'), '采样能力暂无法确认')
  assert.equal(healthCapacityWarning('constructor'), '采样能力暂无法确认')
})
