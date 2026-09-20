import test from "node:test";
import assert from "node:assert/strict";
import {
  CORPORATION_COVER_KEYS,
  defaultCorporationCoverKey,
} from "../../src/utils/corporationCover.js";
import { corporationCoverUrl } from "../../src/utils/corporationCoverAssets.js";

test("four dedicated landscape covers have fixed identifiers", () => {
  assert.deepEqual(CORPORATION_COVER_KEYS, ["fleet", "planet", "shipyard", "nebula"]);
});

test("a persisted corporation keeps its cover across reloads and name changes", () => {
  const key = defaultCorporationCoverKey({ id: 51, name: "远航者" });
  assert.equal(defaultCorporationCoverKey({ id: "51", name: "新名称" }), key);
  assert.equal(defaultCorporationCoverKey({ id: 51 }), key);
  assert.ok(CORPORATION_COVER_KEYS.includes(key));
});

test("sequential corporation IDs spread across all four covers", () => {
  const counts = Object.fromEntries(CORPORATION_COVER_KEYS.map(key => [key, 0]));
  for (let id = 1; id <= 100; id++) counts[defaultCorporationCoverKey({ id })]++;
  for (const count of Object.values(counts)) assert.ok(count >= 20 && count <= 30);
});

test("legacy and unsaved corporations fall back to a stable trimmed name", () => {
  const named = { name: "远航者军团" };
  const key = defaultCorporationCoverKey(named);
  assert.equal(defaultCorporationCoverKey({ name: "  远航者军团  " }), key);
  assert.equal(defaultCorporationCoverKey({ id: "", ...named }), key);
  assert.equal(defaultCorporationCoverKey({ id: null, ...named }), key);
  assert.ok(CORPORATION_COVER_KEYS.includes(defaultCorporationCoverKey({ id: "UUID-🚀" })));
});

test("missing or malformed input gets a usable deterministic cover", () => {
  for (const value of [undefined, null, {}, false, [], "fleet", { id: {} }, { id: NaN }, { name: {} }]) {
    assert.equal(defaultCorporationCoverKey(value), "fleet");
  }
});

test("full-size and thumbnail covers resolve only to dedicated bundled artwork", () => {
  for (const key of CORPORATION_COVER_KEYS) {
    assert.ok(corporationCoverUrl(key).endsWith(`/covers/${key}.webp`));
    assert.ok(corporationCoverUrl(key, true).endsWith(`/covers/${key}-thumb.webp`));
  }
});

test("unrecognized artwork keys never become asset paths", () => {
  for (const key of [null, undefined, {}, "__proto__", "constructor", "../private", "https://other.example/file.webp"])
    assert.equal(corporationCoverUrl(key), corporationCoverUrl("fleet"));
});
