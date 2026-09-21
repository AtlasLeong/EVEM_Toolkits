import test from "node:test";
import assert from "node:assert/strict";
import { selectDefaultTacticalOrganization } from "../../src/utils/tacticalOrganization.js";

const organizations = [
  { id: 1, name: "北境联合 · 本地演习", status: "active" },
  { id: 7, name: "真实星图 · 本地演习", status: "active" },
];

test("tactical local mode prefers the real-map demo organization", () => {
  assert.equal(selectDefaultTacticalOrganization(organizations, { preferRealMap: true }), 7);
});

test("an explicit organization selection always wins over the local default", () => {
  assert.equal(selectDefaultTacticalOrganization(organizations, { requested: "1", preferRealMap: true }), 1);
});

test("ordinary mode keeps the first active organization", () => {
  assert.equal(selectDefaultTacticalOrganization(organizations), 1);
});
