import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createCommunitySandbox,
  resolveCommunityPreview,
  demoLocation,
} from "./community.mjs";

test("location snapshots retain separate region constellation and system security", () => {
  const ids = {
    region_id: "derelik",
    constellation_id: "12",
    solarsystem_id: "22",
  };
  assert.deepEqual(demoLocation(ids), {
    ...ids,
    region_name: "德里克",
    constellation_name: "玛莫纳",
    solarsystem_name: "库哈拉赫",
    region_security: 0.5,
    constellation_security: 0.16,
    solarsystem_security: 0.18,
    security: 0.18,
  });
  const partial = demoLocation({ region_id: "silent" });
  assert.equal(partial.region_security, -0.29);
  assert.equal(partial.constellation_security, null);
  assert.equal(partial.solarsystem_security, null);
});

function client(fixtures) {
  const resolve = createCommunitySandbox(fixtures);
  return (path, method = "GET", body = {}, role = "owner") =>
    resolve(new URL(`http://127.0.0.1/api/community/${path}`), method, body, {
      role,
    });
}

function legacyFixture(overrides = {}) {
  return [
    {
      id: 1,
      name: "历史军团",
      short_name: "OLD",
      published_at: "2026-09-20T12:00:00Z",
      revision: {
        introduction: "旧版介绍",
        public_contact: "公开联系",
        activities: ["pvp"],
        event_title: "旧版远征",
        event_time: "过去的周六",
        event_location: "旧版集结点",
        event_description: "旧版活动说明",
        ...overrides,
      },
    },
  ];
}

test("ordinary demo owner cannot review corporation submissions", () => {
  const response = resolveCommunityPreview(
    new URL("http://127.0.0.1/api/community/capabilities/"),
    "GET",
    {},
    { role: "owner" },
  );
  assert.equal(response.status, 200);
  assert.equal(response.data.can_review, false);
});

test("guest cannot read private corporation management", () => {
  const response = resolveCommunityPreview(
    new URL("http://127.0.0.1/api/community/corporations/1/manage/"),
    "GET",
    {},
    { role: "guest" },
  );
  assert.equal(response.status, 401);
});

test("demo owner can submit a creation application without automatic approval", () => {
  const response = resolveCommunityPreview(
    new URL("http://127.0.0.1/api/community/claims/"),
    "POST",
    {
      request_id: "7dce047a-3df8-4190-af4b-f1f1a4f5a53b",
      name: "沙盒新军团",
      short_name: "LOCAL",
      statement: "我是本地演示管理者",
      contact: "仅本地测试",
    },
    { role: "owner" },
  );
  assert.equal(response.status, 201);
  assert.equal(response.data.status, "pending");
});

test("approved application identity replaces a rejected predecessor without changing corporation ID", () => {
  const call = client();
  const payload = { name: "身份核验军团", short_name: "WRONG", statement: "核验", contact: "私密" };
  const first = call("claims/", "POST", { ...payload, request_id: randomUUID() }).data;
  assert.equal(first.proposed_short_name, "WRONG");
  call(`reviews/claims/${first.id}/decision/`, "POST", { decision: "reject", reason: "信息错误" }, "reviewer");
  const second = call("claims/", "POST", { ...payload, short_name: "RIGHT", request_id: randomUUID() }).data;
  assert.equal(second.corporation.id, first.corporation.id);
  assert.equal(second.proposed_short_name, "RIGHT");
  const approved = call(`reviews/claims/${second.id}/decision/`, "POST", { decision: "approve", reason: "已核验" }, "reviewer");
  assert.equal(approved.status, 200);
  assert.equal(call(`corporations/${first.corporation.id}/manage/`).data.short_name, "RIGHT");
});

test("sandbox generic text rejects lone Unicode surrogates before saving", () => {
  const call = client();
  for (const tagline of ["\ud800", "bad\udfff"]) {
    assert.equal(call("revisions/11/", "PATCH", { expected_version: 1, tagline }).status, 400);
    assert.equal(call("corporations/1/manage/").data.working_revision.version, 1);
  }
  const invalid = call("claims/", "POST", {
    request_id: randomUUID(), name: "\ud800", short_name: "BAD", statement: "核验", contact: "联系",
  });
  assert.equal(invalid.status, 400);
});

test("sandbox historical malformed text is rendered safely without modifying fixtures", () => {
  const fixtures = legacyFixture({ tagline: "\ud800", introduction: "hello\udfff" });
  const before = structuredClone(fixtures);
  const call = client(fixtures);
  assert.equal(call("corporations/1/").data.revision.tagline, "");
  assert.equal(call("corporations/1/manage/").data.working_revision.introduction, "");
  assert.deepEqual(fixtures, before);
});

test("owner and reviewer complete a versioned creation, withdrawal and publication lifecycle", () => {
  const call = (path, method = "GET", body = {}, role = "owner") =>
    resolveCommunityPreview(
      new URL(`http://127.0.0.1/api/community/${path}`),
      method,
      body,
      { role },
    );
  const claimBody = {
    request_id: "9dce047a-3df8-4190-af4b-f1f1a4f5a53b",
    name: "完整测试军团",
    short_name: "TEST",
    statement: "核实管理权",
    contact: "私密联系",
  };
  const application = call("claims/", "POST", claimBody);
  assert.equal(application.status, 201);
  const claimId = application.data.id;
  const corpId = application.data.corporation.id;
  assert.equal(call("claims/", "POST", claimBody).data.id, claimId);
  assert.equal(
    call("claims/", "POST", { ...claimBody, contact: "不同内容" }).status,
    409,
  );
  assert.equal(call(`corporations/${corpId}/`).status, 404);
  assert.equal(call(`corporations/${corpId}/manage/`).status, 404);
  assert.equal(call("reviews/").status, 403);
  assert.equal(
    call(
      `reviews/claims/${claimId}/decision/`,
      "POST",
      { decision: "approve", reason: "演示核验" },
      "reviewer",
    ).status,
    200,
  );
  assert.equal(
    call(`corporations/${corpId}/manage/`).data.working_revision,
    null,
  );
  const draftBody = { request_id: "4dce047a-3df8-4190-af4b-f1f1a4f5a53b" };
  const draft = call(`corporations/${corpId}/draft/`, "POST", draftBody);
  assert.equal(draft.status, 201);
  assert.equal(draft.data.activity_description, "");
  assert.deepEqual(draft.data.custom_activity_tags, []);
  assert.equal(draft.data.activity_content_kind, "overview");
  assert.equal(
    call(`corporations/${corpId}/draft/`, "POST", draftBody).data.id,
    draft.data.id,
  );
  const rev = draft.data.id;
  assert.equal(
    call(`revisions/${rev}/`, "PATCH", { expected_version: 99 }).status,
    409,
  );
  let saved = call(`revisions/${rev}/`, "PATCH", {
    expected_version: 1,
    introduction: "本地沙盒正式简介",
    public_contact: "公开联系方式",
    base_location: {
      region_id: "derelik",
      constellation_id: "12",
      solarsystem_id: "22",
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.base_location.solarsystem_name, "库哈拉赫");
  assert.equal(saved.data.version, 2);
  assert.equal(
    call(`revisions/${rev}/submit/`, "POST", { expected_version: 2 }).data
      .status,
    "pending",
  );
  assert.equal(
    call(`revisions/${rev}/`, "PATCH", {
      expected_version: 3,
      introduction: "不应改变",
    }).status,
    409,
  );
  assert.equal(
    call(`revisions/${rev}/withdraw/`, "POST", { expected_version: 3 }).data
      .status,
    "withdrawn",
  );
  const replacement = call(`corporations/${corpId}/draft/`, "POST", {
    request_id: "5dce047a-3df8-4190-af4b-f1f1a4f5a53b",
  });
  assert.notEqual(replacement.data.id, rev);
  assert.equal(replacement.data.introduction, "本地沙盒正式简介");
  assert.equal(
    call(`revisions/${replacement.data.id}/submit/`, "POST", {
      expected_version: 1,
    }).status,
    200,
  );
  assert.equal(call(`corporations/${corpId}/`, "GET", {}, "guest").status, 404);
  assert.equal(
    call(
      `reviews/revisions/${replacement.data.id}/decision/`,
      "POST",
      { decision: "approve", reason: "" },
      "reviewer",
    ).status,
    200,
  );
  const published = call(`corporations/${corpId}/`, "GET", {}, "guest");
  assert.equal(published.data.revision.introduction, "本地沙盒正式简介");
  assert.equal(published.data.revision.review_reason, undefined);
  assert.equal(published.data.contact, undefined);
  assert.equal(
    call(`corporations/${corpId}/draft/`, "POST", {
      request_id: "6dce047a-3df8-4190-af4b-f1f1a4f5a53b",
    }).status,
    201,
  );
});

test("demo fixtures include a current overview and an explicitly legacy event", () => {
  const call = client();
  const current = call("corporations/1/").data.revision;
  assert.equal(current.activity_content_kind, "overview");
  assert.match(current.activity_description, /主权战|反收割/);
  assert.ok(current.activities.includes("sovereignty_production"));
  assert.ok(current.custom_activity_tags.length > 0);
  const legacy = call("corporations/2/").data.revision;
  assert.equal(legacy.activity_content_kind, "legacy_event");
  assert.equal(legacy.activity_description, "");
  assert.ok(legacy.event_title);
});

test("activity overview and custom tags accept codepoint boundaries and trim display text", () => {
  const call = client();
  const description = "🚀".repeat(1500);
  const tags = ["  反收割  ", "🚀".repeat(12), "周末远征", "护航", "WH"];
  const response = call("revisions/11/", "PATCH", {
    expected_version: 1,
    activity_description: description,
    custom_activity_tags: tags,
    activities: [
      "sovereignty_production",
      "pirate_combat",
      "pve",
      "industry",
      "exploration",
      "mining",
      "training",
    ],
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.activity_description, description);
  assert.deepEqual(
    response.data.custom_activity_tags,
    tags.map((tag) => tag.trim()),
  );
  assert.equal(response.data.activity_content_kind, "overview");
});

test("activity overview rejects invalid types and codepoint overflow without saving", () => {
  const call = client();
  for (const value of [
    null,
    1,
    [],
    {},
    "字".repeat(1501),
    "🚀".repeat(1501),
    " ".repeat(1501),
    "\ud800",
    "\udfff",
  ]) {
    assert.equal(
      call("revisions/11/", "PATCH", {
        expected_version: 1,
        activity_description: value,
      }).status,
      400,
      JSON.stringify(value).slice(0, 60),
    );
  }
  assert.equal(call("corporations/1/manage/").data.working_revision.version, 1);
});

test("custom tags reject invalid shapes, reserved names, invisible text and normalized duplicates", () => {
  const call = client();
  const invalid = [
    null,
    "反收割",
    {},
    [1],
    [[]],
    [{}],
    [""],
    ["   "],
    ["字".repeat(13)],
    ["🚀".repeat(13)],
    ["一", "二", "三", "四", "五", "六"],
    ["反收割", " 反收割 "],
    ["WH", "ｗｈ"],
    ["Straße", "STRASSE"],
    ["Σ", "ς"],
    ["主权生产"],
    ["海盗作战"],
    ["舰队作战"],
    ["舰队作战（旧标签）"],
    ["异常与任务"],
    ["工业制造"],
    ["星海探索"],
    ["采矿生产"],
    ["新人培养"],
    ["\n反收割"],
    ["反\t收割"],
    ["反\u200b收割"],
    ["\ufeff反收割"],
    ["反\u2028收割"],
    ["反\u2029收割"],
    ["\ud800"],
    ["\udfff"],
  ];
  for (const value of invalid) {
    assert.equal(
      call("revisions/11/", "PATCH", {
        expected_version: 1,
        custom_activity_tags: value,
      }).status,
      400,
      JSON.stringify(value),
    );
  }
  assert.equal(call("corporations/1/manage/").data.working_revision.version, 1);
  assert.equal(
    call("revisions/11/", "PATCH", {
      expected_version: 1,
      custom_activity_tags: [],
    }).status,
    200,
  );
});

test("legacy pvp may be retained or removed but never newly added or inferred", () => {
  const current = client();
  assert.equal(
    current("revisions/11/", "PATCH", {
      expected_version: 1,
      activities: ["pvp"],
    }).status,
    400,
  );
  const call = client(legacyFixture());
  let response = call("revisions/11/", "PATCH", {
    expected_version: 1,
    tagline: "只改口号",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.activities, ["pvp"]);
  response = call("revisions/11/", "PATCH", {
    expected_version: response.data.version,
    activities: ["pvp", "pirate_combat"],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.activities, ["pvp", "pirate_combat"]);
  response = call("revisions/11/", "PATCH", {
    expected_version: response.data.version,
    activities: ["sovereignty_production"],
  });
  assert.equal(response.status, 200);
  assert.equal(
    call("revisions/11/", "PATCH", {
      expected_version: response.data.version,
      activities: ["pvp"],
    }).status,
    400,
  );
});

test("activity enums reject unknown, duplicate and malformed values", () => {
  const call = client();
  for (const activities of [
    null,
    "pve",
    ["custom"],
    ["pve", "pve"],
    [{}],
    [1],
  ]) {
    assert.equal(
      call("revisions/11/", "PATCH", { expected_version: 1, activities })
        .status,
      400,
    );
  }
});

test("legacy copies retain their kind until an explicit overview write, including empty text", () => {
  const call = client(legacyFixture());
  let draft = call("corporations/1/manage/").data.working_revision;
  assert.equal(draft.activity_content_kind, "legacy_event");
  assert.equal(draft.activity_description, "");
  draft = call("revisions/11/", "PATCH", {
    expected_version: draft.version,
    tagline: "仅改口号",
  }).data;
  assert.equal(draft.activity_content_kind, "legacy_event");
  draft = call("revisions/11/submit/", "POST", {
    expected_version: draft.version,
  }).data;
  call("revisions/11/withdraw/", "POST", { expected_version: draft.version });
  draft = call("corporations/1/draft/", "POST", {
    request_id: randomUUID(),
  }).data;
  assert.equal(draft.activity_content_kind, "legacy_event");
  assert.equal(draft.event_title, "旧版远征");
  draft = call(`revisions/${draft.id}/`, "PATCH", {
    expected_version: draft.version,
    activity_description: "",
  }).data;
  assert.equal(draft.activity_content_kind, "overview");
  assert.equal(draft.activity_description, "");
  assert.equal(draft.event_description, "旧版活动说明");
  assert.equal(
    call("corporations/1/").data.revision.activity_content_kind,
    "legacy_event",
  );
  assert.equal(
    call(`revisions/${draft.id}/`, "PATCH", {
      expected_version: draft.version,
      activity_content_kind: "legacy_event",
    }).status,
    400,
  );
  call(`revisions/${draft.id}/submit/`, "POST", {
    expected_version: draft.version,
  });
  call(
    `reviews/revisions/${draft.id}/decision/`,
    "POST",
    { decision: "approve", reason: "" },
    "reviewer",
  );
  const published = call("corporations/1/").data.revision;
  assert.equal(published.activity_content_kind, "overview");
  assert.equal(published.activity_description, "");
  assert.equal(published.event_description, "旧版活动说明");
  const replacement = call("corporations/1/draft/", "POST", {
    request_id: randomUUID(),
  }).data;
  assert.equal(replacement.activity_content_kind, "overview");
});

test("read side normalizes malformed activity fields without mutating historical snapshots", () => {
  const fixtures = legacyFixture({
    activities: ["pvp", null, {}, "pvp", "unknown", "pirate_combat"],
    activity_description: { bad: true },
    custom_activity_tags: [
      null,
      "反收割",
      " 反收割 ",
      "主权生产",
      "护航",
      "\ufeff坏标签",
    ],
  });
  const original = structuredClone(fixtures);
  const call = client(fixtures);
  const content = call("corporations/1/").data.revision;
  assert.deepEqual(content.activities, ["pvp", "pirate_combat"]);
  assert.equal(content.activity_description, "");
  assert.equal(content.activity_content_kind, "overview");
  assert.deepEqual(content.custom_activity_tags, ["反收割", "护航"]);
  assert.deepEqual(fixtures, original);
  const long = client(
    legacyFixture({ activity_description: "🚀".repeat(1501) }),
  );
  assert.equal(
    [...long("corporations/1/").data.revision.activity_description].length,
    1500,
  );
  const malformed = client(
    legacyFixture({
      activities: null,
      custom_activity_tags: {},
      activity_description: null,
    }),
  );
  const normalized = malformed("corporations/1/").data.revision;
  assert.deepEqual(normalized.activities, []);
  assert.deepEqual(normalized.custom_activity_tags, []);
  assert.equal(normalized.activity_description, "");
  assert.equal(normalized.activity_content_kind, "overview");
  assert.equal(malformed("corporations/?activity=pvp").data.count, 0);
  for (const value of ["\ud800", "\udfff"]) {
    const invalidUnicode = client(
      legacyFixture({
        activity_description: value,
        custom_activity_tags: [value, "护航"],
      }),
    );
    const safe = invalidUnicode("corporations/1/").data.revision;
    assert.equal(safe.activity_description, "");
    assert.deepEqual(safe.custom_activity_tags, ["护航"]);
    assert.equal(safe.activity_content_kind, "overview");
  }
});

test("public filters allow current enums and legacy pvp but never custom tag search or inferred splits", () => {
  const call = client();
  assert.equal(
    call("corporations/?activity=sovereignty_production").data.count,
    1,
  );
  assert.equal(call("corporations/?activity=pirate_combat").status, 200);
  assert.equal(call("corporations/?activity=反收割").status, 400);
  assert.equal(call("corporations/?activity=unknown").status, 400);
  const legacy = client(legacyFixture());
  assert.equal(legacy("corporations/?activity=pvp").data.count, 1);
  assert.equal(
    legacy("corporations/?activity=sovereignty_production").data.count,
    0,
  );
  assert.equal(legacy("corporations/?activity=pirate_combat").data.count, 0);
});
