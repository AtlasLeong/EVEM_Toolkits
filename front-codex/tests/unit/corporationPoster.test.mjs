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

test("eight original backgrounds replace every legacy option", () => {
  assert.deepEqual(Object.keys(POSTER_BACKGROUNDS), [
    "expedition-fleet", "ringed-planet", "spiral-galaxy", "orbital-shipyard",
    "black-hole", "stellar-nursery", "frozen-frontier", "wreckfield",
  ]);
  assert.equal(normalizePosterBackground("not-a-background"), "expedition-fleet");
  for (const invalid of [null, undefined, {}, [], "__proto__", "constructor"])
    assert.equal(normalizePosterBackground(invalid), "expedition-fleet");
  for (const [old, current] of Object.entries({
    "deep-space": "spiral-galaxy", "ion-storm": "stellar-nursery",
    "tactical-grid": "orbital-shipyard", "jump-rift": "black-hole",
    "sovereignty-border": "ringed-planet", "pirate-tide": "wreckfield",
  })) assert.equal(normalizePosterBackground(old), current);
});

const artwork = { width: 1080, height: 1440 };

test("approved posters omit platform branding while retaining corporation content", () => {
  for (const template of Object.keys(POSTER_TEMPLATES)) {
    const rendered = [];
    const ctx = new Proxy({
      measureText: (value) => ({ width: measure(value) }),
      fillText: (value) => rendered.push(value),
    }, { get: (target, key) => target[key] ?? (() => {}) });
    drawCorporationPoster({ getContext: () => ctx }, { name: "远航军团", short_name: "VOY" }, {
      public_contact: "游戏内联系招募官", event_title: "周末远征", introduction: "共同探索星海",
    }, template, true, { background: artwork });
    assert.ok(!rendered.some(value => /EVEM|军团资料已审核|活动信息请向军团确认/.test(value)), "platform branding must not be printed on the poster");
    assert.ok(rendered.includes("远航军团"));
    assert.ok(rendered.includes("VOY · " + POSTER_TEMPLATES[template]));
    assert.ok(rendered.includes("游戏内联系招募官"));
  }
});

test("every background draws the supplied artwork without repeated grid or orbital ornaments", () => {
  const drawn = [];
  const createContext = () =>
    new Proxy(
      {
        fillRect: () => {},
        fillText: () => {},
        measureText: (text) => ({ width: measure(text) }),
        drawImage: (image) => drawn.push(image),
        arc: () => assert.fail("no decorative orbital rings"),
        lineTo: () => assert.fail("no decorative grid"),
      },
      { get: (target, key) => target[key] ?? (() => {}) },
    );
  for (const key of Object.keys(POSTER_BACKGROUNDS))
    assert.doesNotThrow(() =>
      drawPosterBackground(createContext(), key, artwork),
    );
  assert.equal(drawn.length, 8);
  assert.ok(drawn.every((item) => item === artwork));
  assert.throws(() => drawPosterBackground(createContext(), "expedition-fleet"), /背景/);
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
    { background: artwork },
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
  }, "recruitment", true, { background: artwork });
  const tagline = rendered.filter(({ value }) => value.startsWith("远远"));
  const metadata = rendered.find(({ value }) => value.includes("海盗"));
  const last = tagline.at(-1);
  const size = Number(last.font.match(/(\d+)px/)[1]);
  assert.ok(last.y + size + 8 <= metadata.y, "tagline collides with metadata");
});

test("all artwork and template combinations remain bounded and retain location and approval information", () => {
  for (const background of Object.keys(POSTER_BACKGROUNDS)) {
    for (const template of Object.keys(POSTER_TEMPLATES)) {
      const rendered = [];
      const ctx = new Proxy({
        measureText: (value) => ({ width: measure(value) }),
        fillText: (value, x, y) => rendered.push({ value, x, y }),
        arc: () => assert.fail("old orbital decoration must be removed"),
      }, { get: (target, key) => target[key] ?? (() => {}) });
      const canvas = { getContext: () => ctx };
      drawCorporationPoster(canvas, { name: "远航军团" }, {
        poster_background: background,
        base_location: { region_name: "德里克", constellation_name: "阿玛", solarsystem_name: "测试星系" },
        public_contact: "请联系招募官", event_time: "今晚20:00", event_location: "集结星系",
      }, template, false, { background: artwork });
      assert.equal(canvas.width, 1080);
      assert.equal(canvas.height, 1440);
      assert.ok(rendered.every(({ y }) => y >= 0 && y < 1440));
      assert.ok(rendered.some(({ value }) => value.includes("未审核")));
      assert.ok(rendered.some(({ value }) => value.includes("请联系招募官")));
      if (template !== "event") assert.ok(rendered.some(({ value }) => value.includes("测试星系")));
    }
  }
});
