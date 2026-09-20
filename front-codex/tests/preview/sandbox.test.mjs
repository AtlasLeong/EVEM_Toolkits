import test from "node:test";
import assert from "node:assert/strict";
import { resolveCommunityPreview } from "./community.mjs";

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
