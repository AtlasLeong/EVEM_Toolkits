const production = Boolean(import.meta.env?.PROD)
const enabledValue = String(import.meta.env?.VITE_VIEWER_ALLOWLIST_ENABLED ?? 'true').trim().toLowerCase()

// Local development and e2e previews stay usable without a production login.
export const VIEWER_ACCESS_ENABLED = production && !['0', 'false', 'no', 'off'].includes(enabledValue)

const configuredEmails = String(import.meta.env?.VITE_VIEWER_ALLOWLIST_EMAILS ?? '2235102484@qq.com')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean)

export function isViewerAllowed(email) {
  if (!VIEWER_ACCESS_ENABLED) return true
  return configuredEmails.includes(String(email ?? '').trim().toLowerCase())
}
