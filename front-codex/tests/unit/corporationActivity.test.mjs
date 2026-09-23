import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_OPTIONS,
  activityLabels,
  activityKind,
  validateCustomActivityTags,
  normalizeCustomActivityTags,
} from "../../src/utils/corporationActivity.js";

test("new activity choices replace pvp, while legacy labels remain readable", () => {
  assert.equal(ACTIVITY_OPTIONS.sovereignty_production, "主权生产");
  assert.equal(ACTIVITY_OPTIONS.pirate_combat, "海盗作战");
  assert.equal(Object.hasOwn(ACTIVITY_OPTIONS, "pvp"), false);
  assert.deepEqual(
    activityLabels(
      ["pvp", "pirate_combat", "__proto__", "pirate_combat"],
      ["反收割"],
    ),
    ["舰队作战（旧标签）", "海盗作战", "反收割"],
  );
  assert.deepEqual(activityLabels({}, [null]), []);
});

test("custom tags trim, count Unicode code points, and reject invalid values", () => {
  assert.deepEqual(validateCustomActivityTags([" 反收割 ", "🚀".repeat(12)]), [
    "反收割",
    "🚀".repeat(12),
  ]);
  for (const value of [
    null,
    "反收割",
    [""],
    [3],
    ["a\nb"],
    ["a\u200bb"],
    ["a\tb"],
    ["\ud800"],
    ["\udfff"],
    ["x".repeat(13)],
    ["1", "2", "3", "4", "5", "6"],
  ]) {
    assert.throws(() => validateCustomActivityTags(value));
  }
});

test("custom tag duplicates use Unicode compatibility and case-insensitive matching", () => {
  for (const value of [
    ["abc", "ＡＢＣ"],
    ["Straße", "STRASSE"],
    ["ΟΣ", "οσ"],
    ["ẞ", "ss"],
    ["主权生产"],
    ["舰队作战"],
    ["海盗作战"],
  ]) {
    assert.throws(() => validateCustomActivityTags(value), /重复|内置/);
  }
  assert.deepEqual(validateCustomActivityTags(["ı", "i"]), ["ı", "i"]);
});

test("read normalization does not mutate malformed legacy arrays", () => {
  const raw = [" a ", "Ａ", null, "主权生产", "反收割", "\n", "x".repeat(13)];
  const before = structuredClone(raw);
  assert.deepEqual(normalizeCustomActivityTags(raw), ["a", "反收割"]);
  assert.deepEqual(raw, before);
  assert.deepEqual(normalizeCustomActivityTags({}), []);
});

test("explicit empty overview never resurrects a legacy scheduled event", () => {
  assert.equal(activityKind({ event_title: "过期活动" }), "legacy_event");
  assert.equal(
    activityKind({ activity_description: "", event_title: "过期活动" }),
    "overview",
  );
  assert.equal(
    activityKind({
      activity_content_kind: "legacy_event",
      activity_description: "",
    }),
    "legacy_event",
  );
  assert.equal(activityKind(null), "legacy_event");
});
