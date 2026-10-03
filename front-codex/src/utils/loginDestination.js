// Accept only the routes this application owns. Never send a login response to
// an arbitrary URL, or back into an authentication route.
const staticDestinations = new Set([
  '/', '/infocenter', '/fraudlist', '/planetary', '/market', '/market/admin',
  '/manufacturing', '/killboard', '/killboard/admin', '/feedback', '/corporations',
  '/corporations/manage', '/corporations/review', '/starmap', '/tactical',
  '/tactical/usage', '/usersetting', '/fraudadmin', '/licenseadmin',
])

function allowedDestination(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/.test(value)) return ''
  if (staticDestinations.has(value) ||
    /^\/starsea(?:\/(?:new|mine|review(?:\/[1-9]\d*)?|[1-9]\d*(?:\/edit)?))?$/.test(value) ||
    /^\/corporations\/[1-9]\d*$/.test(value) ||
    /^\/killboard\/[1-9]\d*$/.test(value) ||
    /^\/tactical\?organization=[1-9]\d*$/.test(value)) return value
  return ''
}

export function loginDestination(search, from) {
  const next = new URLSearchParams(search).get('next') || ''
  return allowedDestination(next) || allowedDestination(from) || '/fraudlist'
}

export function loginReturnPath(location) {
  return allowedDestination(`${location.pathname}${location.search || ''}`) ||
    allowedDestination(location.pathname) || '/fraudlist'
}
