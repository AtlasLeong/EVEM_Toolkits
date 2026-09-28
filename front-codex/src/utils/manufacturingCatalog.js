const VALID_CATEGORIES = new Set(['ship', 'material', 'building'])

function fail(message) {
  throw new TypeError(`Invalid manufacturing catalog: ${message}`)
}

function normalizeId(value, field) {
  const id = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/.test(id)) fail(`${field} must be a positive numeric ID`)
  return id
}

function integer(value, field, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    fail(`${field} must be an integer >= ${min}`)
  }
  return value
}

function normalizeMaterials(materials, index) {
  if (!Array.isArray(materials) || materials.length === 0) {
    fail(`recipes[${index}].materials must contain at least one material`)
  }

  const seen = new Set()
  return materials.map((material, materialIndex) => {
    if (!material || typeof material !== 'object') {
      fail(`recipes[${index}].materials[${materialIndex}] must be an object`)
    }

    const itemId = normalizeId(material.itemId, `recipes[${index}].materials[${materialIndex}].itemId`)
    if (seen.has(itemId)) {
      fail(`recipes[${index}].materials contains duplicate itemId ${itemId}`)
    }
    seen.add(itemId)

    return {
      itemId,
      quantity: integer(material.quantity, `recipes[${index}].materials[${materialIndex}].quantity`, { min: 1 }),
    }
  })
}

function normalizeRecipe(recipe, index) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    fail(`recipes[${index}] must be an object`)
  }

  const productId = normalizeId(recipe.productId, `recipes[${index}].productId`)
  const name = String(recipe.name ?? '').trim()
  if (!name || /[{}\p{Cc}\p{Cf}]/u.test(name)) {
    fail(`recipes[${index}].name must be a usable display name`)
  }
  if (!VALID_CATEGORIES.has(recipe.category)) {
    fail(`recipes[${index}].category must be ship, material, or building`)
  }

  return {
    productId,
    name,
    category: recipe.category,
    outputNum: integer(recipe.outputNum, `recipes[${index}].outputNum`, { min: 1 }),
    materials: normalizeMaterials(recipe.materials, index),
    money: integer(recipe.money, `recipes[${index}].money`),
    time: integer(recipe.time, `recipes[${index}].time`),
    maxInstallQuantity: integer(recipe.maxInstallQuantity, `recipes[${index}].maxInstallQuantity`, { min: 1 }),
  }
}

/**
 * Validate and normalize the static manufacturing fixture.
 *
 * The returned objects are deliberately plain and immutable by convention so
 * estimators can safely index them without mutating the fixture data.
 */
export function normalizeManufacturingCatalog(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('source must be an object')
  }
  if (source.schemaVersion !== 1) fail('schemaVersion must be 1')
  if (!Array.isArray(source.scope)) fail('scope must be an array')
  const scope = new Set(source.scope)
  if (scope.size !== VALID_CATEGORIES.size || source.scope.length !== VALID_CATEGORIES.size || [...scope].some(category => !VALID_CATEGORIES.has(category))) {
    fail('scope must contain only ship, material, and building')
  }
  if (!Array.isArray(source.recipes)) fail('recipes must be an array')
  if (!Array.isArray(source.items)) fail('items must be an array')

  const recipes = source.recipes.map(normalizeRecipe)
  const byId = new Map()
  const byName = new Map()

  for (const recipe of recipes) {
    if (byId.has(recipe.productId)) {
      fail(`duplicate productId ${recipe.productId}`)
    }
    if (byName.has(recipe.name)) {
      fail(`duplicate recipe name ${recipe.name}`)
    }
    byId.set(recipe.productId, recipe)
    byName.set(recipe.name, recipe)
  }

  const counts = {
    all: recipes.length,
    ship: recipes.filter(recipe => recipe.category === 'ship').length,
    material: recipes.filter(recipe => recipe.category === 'material').length,
    building: recipes.filter(recipe => recipe.category === 'building').length,
  }

  const items = new Map()
  for (const item of source.items) {
    const itemId = normalizeId(item?.itemId, 'items.itemId')
    const name = String(item?.name ?? '').trim()
    if (!name || /[{}\p{Cc}\p{Cf}]/u.test(name)) fail(`items.${itemId}.name must be a usable display name`)
    if (items.has(itemId)) fail(`duplicate itemId ${itemId}`)
    items.set(itemId, { itemId, name })
  }
  for (const recipe of recipes) {
    for (const material of recipe.materials) {
      if (!items.has(material.itemId)) fail(`missing display item ${material.itemId}`)
    }
  }

  return { schemaVersion: 1, scope: [...scope], recipes, items, counts, byId, byName }
}

/**
 * Load an already-parsed fixture (or a JSON string) through the same validator.
 */
export function loadManufacturingCatalog(source) {
  let parsed = source
  if (typeof source === 'string') {
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      throw new TypeError(`Invalid manufacturing catalog: malformed JSON (${error.message})`)
    }
  }
  return normalizeManufacturingCatalog(parsed)
}

