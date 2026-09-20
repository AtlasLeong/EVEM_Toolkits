import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { createSandboxMiddleware } from "./http.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPUDWhiYGBgYmBgYGBgAAALyQEDGI7q3gAAAABJRU5ErkJggg==",
  "base64",
);
async function sandbox(t) {
  const server = createServer(createSandboxMiddleware());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (
    path,
    { role, token, body, method = body ? "POST" : "GET", headers = {} } = {},
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(!(body instanceof FormData) && body
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  const login = async (role) => {
    const response = await call("/api/_preview/session", { body: { role } });
    assert.equal(response.status, 200);
    return response.json();
  };
  return { base, call, login };
}

test("HTTP sandbox signs role-separated sessions and refresh tokens, rejects forged and cross-origin access", async (t) => {
  const { call, login } = await sandbox(t);
  const owner = await login("owner");
  const reviewer = await login("reviewer");
  assert.notEqual(owner.access, reviewer.access);
  assert.equal(
    (
      await call("/api/community/capabilities/", { token: owner.access }).then(
        (r) => r.json(),
      )
    ).can_review,
    false,
  );
  assert.equal(
    (
      await call("/api/community/capabilities/", {
        token: reviewer.access,
      }).then((r) => r.json())
    ).can_review,
    true,
  );
  assert.equal(
    (await call("/api/community/mine/", { token: `${owner.access}bad` }))
      .status,
    401,
  );
  assert.equal(
    (await call("/api/community/reviews/", { token: owner.access })).status,
    403,
  );
  assert.equal(
    (
      await call("/api/_preview/session", {
        body: { role: "reviewer" },
        headers: { Origin: "https://example.org" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/user/token/refresh", { body: { refresh: owner.access } }))
      .status,
    401,
  );
  assert.equal(
    (
      await call("/api/user/token/refresh", {
        body: { refresh: owner.refresh },
      })
    ).status,
    200,
  );
  assert.match(
    (
      await call("/api/user/login", {
        body: { username: "real", password: "not-used" },
      }).then((r) => r.json())
    ).error,
    /演示身份/,
  );
});

test("real multipart upload stays private until approved, validates type/signature/size and is removed on republish", async (t) => {
  const { call, login } = await sandbox(t);
  const owner = await login("owner");
  const reviewer = await login("reviewer");
  const upload = (bytes, type = "image/png", id = randomUUID()) => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), "sample.png");
    form.append("request_id", id);
    return call("/api/community/corporations/1/media/", {
      token: owner.access,
      body: form,
    });
  };
  const requestId = randomUUID();
  const response = await upload(png, "image/png", requestId);
  assert.equal(response.status, 201);
  const asset = await response.json();
  assert.equal(asset.width, 2);
  assert.equal(asset.height, 2);
  assert.equal(
    (await upload(png, "image/png", requestId).then((r) => r.json())).id,
    asset.id,
  );
  assert.equal((await call(asset.private_url)).status, 401);
  const privateImage = await call(asset.private_url, { token: owner.access });
  assert.equal(privateImage.headers.get("content-type"), "image/webp");
  const stored = Buffer.from(await privateImage.arrayBuffer());
  assert.equal((await sharp(stored).metadata()).format, "webp");
  assert.equal(
    (await call(`/api/community/corporations/1/media/${asset.id}/`)).status,
    404,
  );
  assert.equal((await upload(Buffer.from("<svg/>"))).status, 400);
  assert.equal((await upload(png, "image/jpeg")).status, 400);
  assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 400);
  assert.equal((await upload(png.subarray(0, 24))).status, 400);
  const corrupt = Buffer.from(png);
  corrupt[50] ^= 1;
  assert.equal((await upload(corrupt)).status, 400);
  let revision = await call("/api/community/revisions/11/", {
    method: "PATCH",
    token: owner.access,
    body: { expected_version: 1, cover_asset_id: asset.id },
  }).then((r) => r.json());
  assert.equal(revision.cover_url, asset.private_url);
  await call("/api/community/revisions/11/submit/", {
    token: owner.access,
    body: { expected_version: revision.version },
  });
  await call("/api/community/reviews/revisions/11/decision/", {
    token: reviewer.access,
    body: { decision: "approve", reason: "" },
  });
  assert.equal(
    (await call(`/api/community/corporations/1/media/${asset.id}/`)).status,
    200,
  );
  const draft = await call("/api/community/corporations/1/draft/", {
    token: owner.access,
    body: { request_id: randomUUID() },
  }).then((r) => r.json());
  revision = await call(`/api/community/revisions/${draft.id}/`, {
    method: "PATCH",
    token: owner.access,
    body: { expected_version: draft.version, cover_asset_id: null },
  }).then((r) => r.json());
  await call(`/api/community/revisions/${draft.id}/submit/`, {
    token: owner.access,
    body: { expected_version: revision.version },
  });
  await call(`/api/community/reviews/revisions/${draft.id}/decision/`, {
    token: reviewer.access,
    body: { decision: "approve", reason: "" },
  });
  assert.equal(
    (await call(`/api/community/corporations/1/media/${asset.id}/`)).status,
    404,
  );
});

test("JPEG and WebP real files upload and remain inaccessible from unowned corporations", async (t) => {
  const { call, login } = await sandbox(t);
  const owner = await login("owner");
  for (const [relativePath, type, name] of [
    [
      "../../../backend/static/source-group-icon/naibashangyelianmeng.jpg",
      "image/jpeg",
      "image.jpg",
    ],
    [
      "../../src/assets/corporations/posters/expedition-fleet-thumb.webp",
      "image/webp",
      "image.webp",
    ],
  ]) {
    const bytes = await readFile(new URL(relativePath, import.meta.url));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    form.append("request_id", randomUUID());
    const response = await call("/api/community/corporations/1/media/", {
      token: owner.access,
      body: form,
    });
    assert.equal(response.status, 201);
    const asset = await response.json();
    assert.equal(asset.content_type, "image/webp");
    assert.ok(asset.width > 0 && asset.height > 0);
    assert.equal(
      (
        await call("/api/community/corporations/2/media/", {
          token: owner.access,
          body: form,
        })
      ).status,
      404,
    );
  }
});

async function imageUploadClient(t) {
  const { call, login } = await sandbox(t);
  const owner = await login("owner");
  return {
    call,
    owner,
    upload: (bytes, name, type) => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), name);
      form.append("request_id", randomUUID());
      return call("/api/community/corporations/1/media/", {
        token: owner.access,
        body: form,
      });
    },
  };
}

test("upload validates decoded pixels rather than accepting a synthetic JPEG header", async (t) => {
  const { upload } = await imageUploadClient(t);
  const invalidJpeg = Buffer.from([
    255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 0, 255, 217,
  ]);
  assert.equal(
    (await upload(invalidJpeg, "fake.jpg", "image/jpeg")).status,
    400,
  );
});

test("upload rejects genuine images above production twenty-million pixel limit", async (t) => {
  const { upload } = await imageUploadClient(t);
  const oversized = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: "#203040" },
  })
    .png()
    .toBuffer();
  assert.equal((await upload(oversized, "large.png", "image/png")).status, 400);
});

test("upload rejects animated WebP and mismatched filename extensions", async (t) => {
  const { upload } = await imageUploadClient(t);
  const pixels = Buffer.alloc(4 * 8 * 3);
  for (let i = 0; i < 4 * 8; i++) pixels[i * 3 + (i < 16 ? 0 : 2)] = 255;
  const animated = await sharp(pixels, {
    raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  assert.equal(
    (await upload(animated, "animation.webp", "image/webp")).status,
    400,
  );
  assert.equal((await upload(png, "wrong.jpg", "image/png")).status, 400);
});

test("upload rejects an actual two-frame APNG even when decoder exposes only the default frame", async (t) => {
  const { upload } = await imageUploadClient(t);
  const apng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAGQD6AAAAVWPHQAAABZJREFUeJxj/M/AwMDAwMTAwMDAwAAADR0BA2rCm+kAAAAaZmNUTAAAAAEAAAACAAAAAgAAAAAAAAAAAGQD6AAAmiZlyQAAABpmZEFUAAAAAnicY2Rg+M/AwMDEwMDAwMAAAAsfAQM5oA0PAAAAAElFTkSuQmCC",
    "base64",
  );
  assert.equal((await upload(apng, "animation.png", "image/png")).status, 400);
});

test("upload counts an APNG independent default image in addition to its declared animation frames", async (t) => {
  const { upload } = await imageUploadClient(t);
  // Pillow save_all=True, default_image=True, one appended animation frame:
  // acTL.num_frames=1, but Pillow n_frames=2. libvips reports no pages.
  const apngWithDefault = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACGFjVEwAAAABAAAAALQt6aAAAAAWSURBVHicY/zPwMDAwMDEwMDAwMAAAA0dAQNqwpvpAAAAGmZjVEwAAAAAAAAAAgAAAAIAAAAAAAAAAABkA+gAAAFVjx0AAAAaZmRBVAAAAAF4nGNkYPjPwMDAxMDAwMDAAAALHwEDT0U0MgAAAABJRU5ErkJggg==",
    "base64",
  );
  assert.equal((await sharp(apngWithDefault).metadata()).pages, undefined);
  assert.equal(
    (await upload(apngWithDefault, "default-frame.png", "image/png")).status,
    400,
  );
});

test("unauthenticated upload is rejected before image validation", async (t) => {
  const { call } = await sandbox(t);
  const form = new FormData();
  form.append(
    "file",
    new Blob(["not an image"], { type: "image/png" }),
    "bad.png",
  );
  form.append("request_id", randomUUID());
  assert.equal(
    (await call("/api/community/corporations/1/media/", { body: form })).status,
    401,
  );
});

test("upload accepts a genuinely single-frame APNG whose fcTL precedes IDAT", async (t) => {
  const { upload } = await imageUploadClient(t);
  const singleFrameApng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACGFjVEwAAAABAAAAALQt6aAAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAGQD6AAAAVWPHQAAABZJREFUeJxj/M/AwMDAwMTAwMDAwAAADR0BA2rCm+kAAAAASUVORK5CYII=",
    "base64",
  );
  assert.equal(
    (await upload(singleFrameApng, "single-frame.png", "image/png")).status,
    201,
  );
});

test("upload applies orientation, bounds output at 2400 and removes EXIF/ICC/XMP metadata", async (t) => {
  const { upload, call, owner } = await imageUploadClient(t);
  const original = await sharp({
    create: { width: 3000, height: 1000, channels: 3, background: "#203040" },
  })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Artist: "Private Pilot", ImageDescription: "Private memo" },
    })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const response = await upload(original, "oriented.jpg", "image/jpeg");
  assert.equal(response.status, 201);
  const asset = await response.json();
  assert.equal(asset.width, 800);
  assert.equal(asset.height, 2400);
  assert.equal(asset.content_type, "image/webp");
  const stored = Buffer.from(
    await (
      await call(asset.private_url, { token: owner.access })
    ).arrayBuffer(),
  );
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 2400);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.xmp, undefined);
  await sharp(stored).raw().toBuffer();
});

test("HTTP session rejects invalid roles and unsafe Host headers", async (t) => {
  const { call, base } = await sandbox(t);
  assert.equal(
    (await call("/api/_preview/session", { body: { role: "superadmin" } }))
      .status,
    400,
  );
  const unsafeStatus = await new Promise((resolve, reject) => {
    const req = request(
      `${base}/api/_preview/session`,
      {
        method: "POST",
        headers: {
          Host: "external.example",
          "Content-Type": "application/json",
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ role: "owner" }));
  });
  assert.equal(unsafeStatus, 403);
  assert.equal((await call("/api/community/mine/")).status, 401);
  const response = await call("/api/community/corporations/");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.status, 200);
});
