// This switch controls ordinary public reads only. Private routes and API
// resources still require their own authentication and authorization checks.
// Legacy viewer flags and email lists no longer define account eligibility.
const publicAccessValue = String(import.meta.env?.VITE_PUBLIC_READ_ACCESS_ENABLED ?? 'true').trim().toLowerCase()

export const PUBLIC_READ_ACCESS_ENABLED = ['1', 'true', 'yes', 'on'].includes(publicAccessValue)

// Compatibility for callers outside the current frontend. This is a read
// login switch, never an owner, staff or organization permission.
export const VIEWER_ACCESS_ENABLED = !PUBLIC_READ_ACCESS_ENABLED

export function isViewerAllowed() {
  return true
}
