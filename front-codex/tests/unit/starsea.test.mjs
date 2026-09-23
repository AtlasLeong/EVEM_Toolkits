import test from "node:test";
import assert from "node:assert/strict";

const module = await import("../../src/utils/starsea.js").catch(() => ({}));
test("battle totals preserve unknown ISK and group actual quantities", () => {
  assert.equal(
    typeof module.battleSummary,
    "function",
    "battleSummary is implemented",
  );
  assert.deepEqual(
    module.battleSummary({
      sides: [
        {
          name: "北方",
          isk_loss: "",
          losses: [
            { ship_class: "战列舰", quantity: 2 },
            { ship_class: "战列舰", quantity: 3 },
          ],
        },
        { name: "南方", isk_loss: "0", losses: [] },
      ],
    }),
    {
      sides: [
        {
          name: "北方",
          total_ships: 5,
          by_class: [{ name: "战列舰", quantity: 5 }],
          isk_loss: null,
        },
        { name: "南方", total_ships: 0, by_class: [], isk_loss: "0" },
      ],
    },
  );
});
test("battle presentation exposes a stable visual comparison model", () => {
  assert.equal(typeof module.battleVisualSummary, "function");
  assert.deepEqual(
    module.battleVisualSummary({
      sides: [
        { name: "远航编队", isk_loss: "1200000", losses: [{ ship_class: "战列舰", quantity: 6 }] },
        { name: "对方舰队", isk_loss: null, losses: [{ ship_class: "巡洋舰", quantity: 2 }] },
      ],
    }),
    {
      sides: [
        { name: "远航编队", total_ships: 6, by_class: [{ name: "战列舰", quantity: 6 }], isk_loss: "1200000", share: 0.75 },
        { name: "对方舰队", total_ships: 2, by_class: [{ name: "巡洋舰", quantity: 2 }], isk_loss: null, share: 0.25 },
      ],
      total_ships: 8,
      leading_side: 0,
    },
  );
});
test("announcement remains a stable API kind while its UI label is 活动", () => {
  assert.equal(module.KINDS.announcement, "活动");
});
test("paste parser previews valid rows and identifies every invalid line without guessing IDs", () => {
  assert.equal(
    typeof module.parseLossList,
    "function",
    "parseLossList is implemented",
  );
  const parsed = module.parseLossList(
    "战列舰,灾难级,12\n护卫舰 未知 3\n坏数据\n巡洋舰,自填型号,-1",
  );
  assert.deepEqual(parsed.rows, [
    { ship_id: null, ship_name: "灾难级", ship_class: "战列舰", quantity: 12 },
    { ship_id: null, ship_name: "", ship_class: "护卫舰", quantity: 3 },
  ]);
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors[0], /3/);
});
test("write content removes authoritative read snapshots and preserves explicit null ISK", () => {
  assert.equal(
    typeof module.toWriteContent,
    "function",
    "toWriteContent is implemented",
  );
  const value = module.toWriteContent({
    kind: "battle",
    title: "战报",
    body: "",
    location: {
      region_id: 1,
      region_name: "星域",
      constellation_id: null,
      solarsystem_id: null,
    },
    images: [{ id: 2, url: "private", caption: "KM" }],
    battle: {
      sides: [
        {
          name: "A",
          isk_loss: "",
          losses: [
            {
              ship_id: 7,
              ship_name: "舰船",
              ship_class: "战列舰",
              quantity: 2,
              is_custom: false,
              source_version: "SWEET",
            },
          ],
        },
        { name: "B", isk_loss: "0", losses: [] },
      ],
    },
  });
  assert.equal(value.battle.sides[0].isk_loss, null);
  assert.equal(value.battle.sides[1].isk_loss, "0");
  assert.deepEqual(value.images, [{ id: 2, caption: "KM" }]);
  assert.equal(value.battle.sides[0].losses[0].source_version, undefined);
  assert.deepEqual(value.location, {
    region_id: 1,
    constellation_id: null,
    solarsystem_id: null,
  });
});
test("image addresses never accept remote hosts, query strings, or unrelated routes", () => {
  assert.equal(
    typeof module.safeMediaUrl,
    "function",
    "safeMediaUrl is implemented",
  );
  assert.equal(
    module.safeMediaUrl("/api/starsea/media/4/", "https://local.test/api"),
    "https://local.test/api/starsea/media/4/",
  );
  for (const value of [
    "https://bad.test/api/starsea/media/4/",
    "/api/starsea/media/4/?token=secret",
    "/api/community/media/4/",
  ])
    assert.throws(() => module.safeMediaUrl(value, "https://local.test/api"));
});

test("server unknown display sentinel remains unknown when serialized for editing", () => {
  const content = module.newContent();
  content.battle.sides[0].losses = [
    {
      ship_id: null,
      ship_name: "未知型号",
      ship_class: "护卫舰",
      quantity: 2,
      is_custom: true,
    },
  ];
  assert.equal(
    module.toWriteContent(content).battle.sides[0].losses[0].ship_name,
    "",
  );
});

test("ISK formatting preserves exact decimal digits near the allowed maximum", () => {
  assert.equal(typeof module.formatIsk, "function");
  assert.equal(
    module.formatIsk("999999999999999.99"),
    "999,999,999,999,999.99 ISK",
  );
  assert.equal(module.formatIsk("0.00"), "0.00 ISK");
  assert.equal(module.formatIsk(null), "ISK 未统计");
});

test("comma separated loss rows preserve spaces in a model name", () => {
  const parsed = module.parseLossList("战列舰,自填型号 II,12");
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].ship_name, "自填型号 II");
});
