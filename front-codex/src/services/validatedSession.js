const EXPIRY_SKEW_SECONDS = 30

function storedToken(key) {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
}

export function decodeJwtPayload(token) {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decode = typeof window === 'undefined' ? atob : window.atob
    return JSON.parse(decode(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
  } catch {
    return null
  }
}

export function tokenUserId(token) {
  const claims = decodeJwtPayload(token)
  const id = claims?.user_id ?? claims?.userId
  return id == null ? null : String(id)
}

export function isTokenExpired(token, skewSeconds = EXPIRY_SKEW_SECONDS) {
  const claims = decodeJwtPayload(token)
  return !claims?.exp || claims.exp * 1000 <= Date.now() + skewSeconds * 1000
}

// This is a client session boundary; the server still verifies JWTs and resource
// permissions. A partially replaced pair must not select or send another user's
// credentials, even when either token has not expired yet.
export function readValidatedSession() {
  const accessToken = storedToken('access_token')
  const refreshToken = storedToken('refresh_token')
  const accessUserId = tokenUserId(accessToken)
  const refreshUserId = tokenUserId(refreshToken)
  const mismatchedPair = accessUserId != null && refreshUserId != null && accessUserId !== refreshUserId
  const isAuthenticated = !mismatchedPair && (
    Boolean(accessToken && !isTokenExpired(accessToken)) ||
    Boolean(refreshToken && !isTokenExpired(refreshToken))
  )
  // A legacy refresh token can omit identity (or be malformed). When access
  // still identifies its owner, use that known owner for cache and send fences.
  const identityToken = refreshUserId != null ? refreshToken : accessUserId != null ? accessToken : refreshToken || accessToken
  const claims = isAuthenticated ? decodeJwtPayload(identityToken) || decodeJwtPayload(accessToken) : null
  const userInfo = claims ? {
    userName: claims.userName || claims.username || null,
    userId: claims.user_id ?? claims.userId ?? null,
    ...(claims.email ? { email: claims.email } : {}),
  } : null
  // Known identity survives healthy token rotation. Unidentified legacy sessions
  // retain their own raw-token identity instead of sharing a private cache.
  const identity = !isAuthenticated ? 'guest' : userInfo?.userId != null
    ? `user:${String(userInfo.userId)}`
    : `session:${refreshToken || accessToken}`
  return { accessToken, refreshToken, mismatchedPair, isAuthenticated, userInfo, identity }
}
