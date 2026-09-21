function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  return atob(padded)
}

function decodeJWTPayload(token) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null

  try {
    const payload = decodeBase64Url(parts[1])
    return JSON.parse(payload)
  } catch (error) {
    console.error('Error decoding token payload:', error)
    return null
  }
}

export function getUserInfo() {
  // Access-only sessions are supported by fetchWithAuth too. Their account
  // identity must change so private pages unmount immediately on account switch.
  const userToken = localStorage.getItem('refresh_token') || localStorage.getItem('access_token')
  if (!userToken) return null

  const decodedToken = decodeJWTPayload(userToken)
  if (!decodedToken) return null

  return {
    userName: decodedToken.userName || decodedToken.username || null,
    userId: decodedToken.user_id || decodedToken.userId || null,
  }
}
