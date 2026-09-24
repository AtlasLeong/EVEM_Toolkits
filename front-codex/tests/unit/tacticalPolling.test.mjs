import test from "node:test";
import assert from "node:assert/strict";
import { nextTacticalPollDelay, TACTICAL_POLL_MAX_MS, TACTICAL_POLL_MIN_MS, TACTICAL_POLL_STREAM_MS } from "../../src/utils/tacticalPolling.js";

test("hidden tactical boards suspend HTTP polling", () => {
  assert.equal(nextTacticalPollDelay({ visible: false, streamLive: false, requestSucceeded: false, previousDelay: 5000 }), null);
});

test("live streams use a slow heartbeat fallback", () => {
  assert.equal(nextTacticalPollDelay({ visible: true, streamLive: true, requestSucceeded: true, previousDelay: 5000 }), TACTICAL_POLL_STREAM_MS);
});

test("healthy HTTP fallback backs off to the minimum visible interval", () => {
  assert.equal(nextTacticalPollDelay({ visible: true, streamLive: false, requestSucceeded: true, previousDelay: 30000 }), TACTICAL_POLL_MIN_MS);
});

test("failed HTTP fallback uses bounded exponential backoff", () => {
  assert.equal(nextTacticalPollDelay({ visible: true, streamLive: false, requestSucceeded: false, previousDelay: TACTICAL_POLL_MIN_MS }), 10000);
  assert.equal(nextTacticalPollDelay({ visible: true, streamLive: false, requestSucceeded: false, previousDelay: TACTICAL_POLL_MAX_MS }), TACTICAL_POLL_MAX_MS);
});
