import test from "node:test";
import assert from "node:assert/strict";
import {
  wrapPosterText,
  posterFilename,
  POSTER_TEMPLATES,
  drawCorporationPoster,
} from "../../src/utils/corporationPoster.js";

const measure = (text) => [...text].length * 10;
test("wraps Chinese and long tokens without exceeding the line budget", () => {
  const lines = wrapPosterText(
    "一起驶向更加辽阔的星海\nSECOND-LINE-LONG",
    measure,
    60,
    3,
  );
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => measure(line) <= 60));
  assert.ok(lines.at(-1).endsWith("…"));
});
test("empty optional text is safe and filenames cannot become paths", () => {
  assert.deepEqual(wrapPosterText("", measure, 100, 3), []);
  assert.equal(wrapPosterText("🚀🚀🚀", measure, 20, 2).join(""), "🚀🚀🚀");
  assert.ok(
    !/[\\/:*?"<>|]/.test(posterFilename("../星海:军团", "recruitment", false)),
  );
  assert.ok(posterFilename("星海军团", "event", false).includes("未审核"));
  assert.ok(!posterFilename("星海军团", "event", true).includes("未审核"));
});
test("three fixed templates have stable identifiers", () => {
  assert.deepEqual(Object.keys(POSTER_TEMPLATES), [
    "recruitment",
    "introduction",
    "event",
  ]);
});

test("recruitment poster includes both requirements and support, even when both are provided", () => {
  const rendered = [];
  const ctx = new Proxy(
    {
      measureText: (text) => ({ width: measure(text) }),
      fillText: (text) => rendered.push(text),
    },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  drawCorporationPoster(
    { getContext: () => ctx },
    { name: "远航军团", short_name: "VOY" },
    {
      benefits: "新人指导与补损",
      requirements: "愿意团队合作",
      public_contact: "招募官",
    },
    "recruitment",
    false,
  );
  assert.ok(rendered.includes("新人指导与补损"));
  assert.ok(rendered.includes("愿意团队合作"));
});
