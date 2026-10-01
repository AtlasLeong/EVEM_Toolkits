import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
import * as presentation from '../../src/utils/killboardPresentation.js'

const source = readFileSync(new URL('../../src/components/killboard/KillParticipantRow.jsx', import.meta.url), 'utf8').replace(/^import.*$/gm, '')
const compiled = await transform(source, { loader: 'jsx', format: 'cjs', jsx: 'transform' })
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }
const module = { exports: {} }
const dependencies = { React, Crosshair: 'Crosshair', UserRound: 'UserRound', GameItemImage: 'GameItemImage', ...presentation }
new Function(...Object.keys(dependencies), 'module', 'exports', compiled.code)(...Object.values(dependencies), module, module.exports)

test('a source highlight can simultaneously carry final-blow and top-damage badges', () => {
  const tree = module.exports.default({ row: { display_name: '混乱风暴发射器', ship_name: '混乱风暴发射器', identity_kind: 'source', damage: 293464, damage_pct: '29', is_final_blow: true, is_top_damage: true } })
  const serialized = JSON.stringify(tree)
  assert.match(serialized, /混乱风暴发射器/)
  assert.match(serialized, /最后一击/)
  assert.match(serialized, /伤害最多/)
  assert.match(serialized, /29%/)
  assert.doesNotMatch(serialized, /未知角色|NPC/)
})

test('explicit NPC participants render the honest NPC label', () => {
  const tree = module.exports.default({ row: { identity_kind: 'npc', damage: 293464 } })
  const serialized = JSON.stringify(tree)
  assert.match(serialized, /NPC/)
  assert.doesNotMatch(serialized, /角色 ID|身份资料未返回|未知角色/)
})
