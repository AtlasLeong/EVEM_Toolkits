import API_URL from './backendSetting'
import fetchWithAuth from './fetchWithAuth'

async function parseApiError(response, fallback) {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => '')
    return { message: text || fallback }
  })

  throw new Error(payload.error || payload.message || payload.detail || fallback)
}

export async function getPlanetResources() {
  const res = await fetch(`${API_URL}/planetresources`)
  if (!res.ok) {
    throw new Error('Error to fetch Planet Resource')
  }
  return res.json()
}

export async function searchPlanetResources(searchForm) {
  const res = await fetch(`${API_URL}/searchplanetresource`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchForm),
  })
  if (!res.ok) {
    throw new Error('Error to fetch Planet Resource')
  }
  return res.json()
}

export async function getDefaultResourcePriceSetting(resetPrice) {
  const res = await fetchWithAuth(`${API_URL}/planetresourceprice?resetPrice=${resetPrice}`)
  if (!res.ok) {
    throw new Error('Error to fetch default Resource Price')
  }
  return res.json()
}

export async function saveUserPrePrice({ prePriceElement }) {
  const res = await fetchWithAuth(`${API_URL}/planetresourceprice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prePriceElement }),
  })

  if (!res.ok) {
    await parseApiError(res, '保存价格失败')
  }

  return res.json()
}

export async function savePlanetaryProgramme({ calculatorData }) {
  const res = await fetchWithAuth(`${API_URL}/programme`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(calculatorData),
  })

  if (!res.ok) {
    await parseApiError(res, '保存方案失败')
  }

  return res.json()
}

export async function getUserProgremmaList() {
  const res = await fetchWithAuth(`${API_URL}/programme`)
  if (!res.ok) {
    throw new Error('Error to fetch programme')
  }
  return res.json()
}

export async function getUserProgremmaByID(programme_id) {
  const res = await fetchWithAuth(`${API_URL}/programme?programme_id=${programme_id}`)
  if (!res.ok) {
    throw new Error(`Error to fetch programme by id: ${programme_id}`)
  }
  return res.json()
}

export async function deleteProgremmaByID(programme_id) {
  const res = await fetchWithAuth(`${API_URL}/programme`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(programme_id),
  })

  if (!res.ok) {
    await parseApiError(res, '删除方案失败')
  }

  if (res.status === 204) {
    return {}
  }

  return res.json()
}

export async function updateProgremma({ programme_id, element }) {
  const res = await fetchWithAuth(`${API_URL}/programme`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ programme_id, element }),
  })

  if (!res.ok) {
    await parseApiError(res, '更新方案失败')
  }

  if (res.status === 204) {
    return {}
  }

  return res.json()
}
