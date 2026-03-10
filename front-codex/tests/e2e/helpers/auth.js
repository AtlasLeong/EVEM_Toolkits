export function createFakeJwt(payload = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = {
    iat: now,
    exp: now + 60 * 60,
    userName: 'atlas123',
    email: 'atlas@example.com',
    ...payload,
  }

  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode(header)}.${encode(body)}.signature`
}

export async function seedAuthenticatedSession(page, overrides = {}) {
  const access = createFakeJwt(overrides)
  const refresh = createFakeJwt(overrides)

  await page.addInitScript(({ accessToken, refreshToken }) => {
    window.localStorage.setItem('access_token', accessToken)
    window.localStorage.setItem('refresh_token', refreshToken)
  }, { accessToken: access, refreshToken: refresh })

  return { access, refresh }
}
