import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  loadManufacturingCatalog,
  normalizeManufacturingCatalog,
} from '../../src/utils/manufacturingCatalog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(here, '../../public/industry/manufacturing-scope.json')

test('loads the approved ship, industrial-material, and building scope', async () => {
  const source = JSON.parse(await fs.readFile(fixturePath, 'utf8'))
  const catalog = loadManufacturingCatalog(source)

  assert.deepEqual(catalog.counts, {
    all: 503,
    ship: 366,
    material: 31,
    building: 106,
  })
  assert.equal(catalog.recipes.length, 503)
  assert.equal(catalog.byId.get('10100000101').name, '狮鹫级')
  assert.equal(catalog.byName.get('狮鹫级').productId, '10100000101')
  assert.equal(catalog.byId.get('10100000101').category, 'ship')
  assert.equal(catalog.byId.get('10100000101').outputNum, 1)
  assert.ok(Number.isInteger(catalog.byId.get('10100000101').money))
  assert.ok(Number.isInteger(catalog.byId.get('10100000101').time))
  assert.ok(Number.isInteger(catalog.byId.get('10100000101').maxInstallQuantity))
  assert.ok(catalog.byId.get('10100000101').materials.length > 0)
  assert.ok(catalog.byId.get('10100000101').materials.every((material) => (
    typeof material.itemId === 'string' &&
    Number.isInteger(material.quantity) &&
    material.quantity > 0
  )))
  assert.equal(catalog.recipes.some((recipe) => recipe.category === 'ammunition'), false)
  assert.equal(catalog.recipes.some((recipe) => /[{}]/u.test(recipe.name)), false)
})

test('rejects malformed recipes before exposing them to the estimator', () => {
  assert.throws(() => normalizeManufacturingCatalog({
    schemaVersion: 1,
    recipes: [{
      productId: '100',
      name: '坏配方',
      category: 'ship',
      outputNum: 1,
      materials: [{ itemId: '200', quantity: 0 }],
      money: 1,
      time: 1,
      maxInstallQuantity: 1,
    }],
  }), /materials/i)
})

test('rejects duplicate product IDs instead of silently overwriting a recipe', () => {
  const recipe = {
    productId: '100',
    name: '重复物品',
    category: 'ship',
    outputNum: 1,
    materials: [{ itemId: '200', quantity: 1 }],
    money: 1,
    time: 1,
    maxInstallQuantity: 1,
  }
  assert.throws(() => normalizeManufacturingCatalog({
    schemaVersion: 1,
    recipes: [recipe, { ...recipe }],
  }), /duplicate.*productId/i)
})

test('rejects control and zero-width characters in recipe names', () => {
  const recipe = {
    productId: '100',
    name: '坏\u200b配方',
    category: 'ship',
    outputNum: 1,
    materials: [{ itemId: '200', quantity: 1 }],
    money: 1,
    time: 1,
    maxInstallQuantity: 1,
  }

  assert.throws(() => normalizeManufacturingCatalog({
    schemaVersion: 1,
    recipes: [recipe],
  }), /name.*usable/i)

  assert.throws(() => normalizeManufacturingCatalog({
    schemaVersion: 1,
    recipes: [{ ...recipe, name: '坏\u0007配方' }],
  }), /name.*usable/i)
})
