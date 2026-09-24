export const TACTICAL_POLL_MIN_MS = 5000;
export const TACTICAL_POLL_MAX_MS = 30000;
export const TACTICAL_POLL_STREAM_MS = 20000;

/**
 * Selects the next HTTP fallback interval without coupling the session hook
 * to browser timers. Hidden tabs return null so visibility changes, rather
 * than a background timer, control the next refresh.
 */
export function nextTacticalPollDelay({
  visible,
  streamLive,
  requestSucceeded,
  previousDelay = TACTICAL_POLL_MIN_MS,
}) {
  if (!visible) return null;
  if (streamLive) return TACTICAL_POLL_STREAM_MS;
  if (requestSucceeded === false) {
    return Math.min(
      TACTICAL_POLL_MAX_MS,
      Math.max(TACTICAL_POLL_MIN_MS, previousDelay * 2),
    );
  }
  return TACTICAL_POLL_MIN_MS;
}
