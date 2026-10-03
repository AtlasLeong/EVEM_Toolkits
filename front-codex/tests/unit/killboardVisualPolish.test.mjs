import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../../src/styles/killboard.css', import.meta.url), 'utf8')

test('NPC participant rows do not add a separate left boundary or avatar indentation', () => {
  const rules = [...css.matchAll(/\.kb-participant--npc\s*\{([^}]*)\}/g)]
  for (const [, body] of rules) {
    assert.doesNotMatch(body, /border-left\s*:/)
    assert.doesNotMatch(body, /padding-left\s*:/)
  }
})

test('hero artwork is centered at ninety percent scale without changing participant artwork', () => {
  const heroRule = css.match(/\.kb-hero \.kb-asset--ship img\s*\{([^}]*)\}/)?.[1]
  assert.ok(heroRule, 'the report hero image rule exists')
  assert.match(heroRule, /transform:scale\(\.9\)/)
  assert.match(heroRule, /transform-origin:center/)
  assert.match(heroRule, /width:100%;\s*height:100%/)
  assert.match(heroRule, /object-fit:contain/)
  for (const [, body] of css.matchAll(/\.kb-participant-ship img\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(body, /transform\s*:/)
  }
})
