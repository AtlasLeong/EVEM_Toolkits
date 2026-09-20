import test from "node:test";
import assert from "node:assert/strict";
import {
  wrapPosterText,
  posterFilename,
  POSTER_BACKGROUNDS,
  POSTER_TEMPLATES,
  drawPosterBackground,
  drawCorporationPoster,
  normalizePosterBackground,
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

test("six poster backgrounds have stable keys and reject unknown values", () => {
  assert.deepEqual(Object.keys(POSTER_BACKGROUNDS), [
    "deep-space",
    "ion-storm",
    "tactical-grid",
    "jump-rift",
    "sovereignty-border",
    "pirate-tide",
  ]);
  assert.equal(normalizePosterBackground("not-a-background"), "deep-space");
});

test("every poster background draws safely with deterministic Canvas primitives", () => {
  const createContext = () =>
    new Proxy(
      {
        fillRect: () => {},
        fillText: () => {},
        measureText: (text) => ({ width: measure(text) }),
      },
      { get: (target, key) => target[key] ?? (() => {}) },
    );
  for (const key of Object.keys(POSTER_BACKGROUNDS))
    assert.doesNotThrow(() =>
      drawPosterBackground(createContext(), key, "recruitment"),
    );
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
      corp_types: ["pirate"],
      region_tags: ["lowsec", "nullsec"],
      benefit_keys: ["ship_reimbursement", "fleet_training"],
      benefits_note: "新人导师与定期补给",
      alliance: "远航联盟",
      benefits: "新人指导与补损",
      requirements: "愿意团队合作",
      public_contact: "招募官",
    },
    "recruitment",
    false,
  );
  assert.ok(rendered.some((value) => String(value).includes("新人指导与补损")));
  assert.ok(rendered.some((value) => String(value).includes("愿意团队合作")));
  assert.ok(rendered.some((value) => String(value).includes("海盗")));
  assert.ok(rendered.some((value) => String(value).includes("低安")));
  assert.ok(rendered.some((value) => String(value).includes("舰船补损")));
});

test("long tagline is truncated before the metadata row", () => {
  const rendered = [];
  const ctx = new Proxy({
    measureText: (value) => ({ width: [...value].length * 30 }),
    fillText: (value, x, y) => rendered.push({ value, x, y, font: ctx.font }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  drawCorporationPoster({ getContext: () => ctx }, { name: "远航" }, {
    tagline: "远".repeat(80), corp_types: ["pirate"],
  }, "recruitment", true);
  const tagline = rendered.filter(({ value }) => value.startsWith("远远"));
  const metadata = rendered.find(({ value }) => value.includes("海盗"));
  const last = tagline.at(-1);
  const size = Number(last.font.match(/(\d+)px/)[1]);
  assert.ok(last.y + size + 8 <= metadata.y, "tagline collides with metadata");
});
