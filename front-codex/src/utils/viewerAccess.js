const production = Boolean(import.meta.env?.PROD)
// A legacy VITE_VIEWER_ALLOWLIST_ENABLED=false may remain in an old build
// environment. It must not silently reopen a newly private production build.
// Opening later requires the explicit public-access switch.
const publicAccessValue = String(import.meta.env?.VITE_VIEWER_PUBLIC_ACCESS_ENABLED ?? 'false').trim().toLowerCase()

// Local development and e2e previews stay usable without a production login.
export const VIEWER_ACCESS_ENABLED = production && ['0', 'false', 'no', 'off'].includes(publicAccessValue)

const configuredEmails = String(import.meta.env?.VITE_VIEWER_ALLOWLIST_EMAILS ?? '2235102484@qq.com')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean)

export function isViewerAllowed(email) {
  if (!VIEWER_ACCESS_ENABLED) return true
  return configuredEmails.includes(String(email ?? '').trim().toLowerCase())
}
