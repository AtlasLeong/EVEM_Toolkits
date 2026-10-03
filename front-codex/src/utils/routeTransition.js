const KILLBOARD_DETAIL_PATH = /^\/killboard\/\d+$/

export function pageTransitionKey(pathname = '') {
  const path = String(pathname || '')
  return KILLBOARD_DETAIL_PATH.test(path) ? '/killboard' : path
}
