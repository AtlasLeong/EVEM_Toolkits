export const TINY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9kQAAAAASUVORK5CYII='

export function json(data, status = 200, headers = {}) {
  return {
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(data),
  }
}

export async function installApiMock(page, resolver) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const contentType = (await request.headerValue('content-type')) || ''
    const rawBody = request.postData()
    let body = rawBody

    if (rawBody && contentType.includes('application/json')) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = rawBody
      }
    }

    const response = await resolver({
      route,
      request,
      url,
      method: request.method(),
      body,
      rawBody,
    })

    if (response === 'fallback') {
      return route.fallback()
    }

    if (response === undefined) {
      return route.fulfill(json({ error: `Unhandled API route: ${request.method()} ${url.pathname}${url.search}` }, 501))
    }

    return route.fulfill(response)
  })
}
