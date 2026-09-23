import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../../src/services/fetchWithAuth.js", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "authModule",
  define: { "import.meta.env": JSON.stringify({ VITE_API_URL: "http://local-test/api" }) },
});
const jwt = (user, expires = 600, nonce = "first") =>
  `x.${Buffer.from(JSON.stringify({ user_id: user, exp: Date.now() / 1000 + expires, jti: nonce })).toString("base64url")}.x`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const response = (access) => ({ ok: Boolean(access), json: async () => ({ access }) });

function fixture(fetchImpl) {
  const values = new Map();
  const window = new EventTarget();
  window.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  window.atob = atob;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  const context = vm.createContext({ window, Event, FormData, AbortController, DOMException, fetch: fetchImpl });
  vm.runInContext(compiled.outputFiles[0].text, context);
  const auth = context.authModule;
  const login = (user, expires = 600, nonce = "first") => {
    values.set("access_token", jwt(user, expires, nonce));
    values.set("refresh_token", jwt(user, 3600, nonce));
    auth.notifyAuthChanged();
  };
  return { auth, login, values, window };
}
const sessionChanged = (error) => error?.name === "AuthSessionChangedError";

test("logout while refreshing does not resurrect credentials or send the pending request", async () => {
  const refresh = deferred();
  let requests = 0;
  const { auth, login, values } = fixture((url) => {
    if (url.endsWith("/refresh")) return refresh.promise;
    requests++;
    return Promise.resolve({ status: 200 });
  });
  login("A", -60);
  const pending = auth.default("http://local-test/api/community/mine/");
  auth.clearStoredAuth();
  refresh.resolve(response(jwt("A")));
  await assert.rejects(pending, sessionChanged);
  assert.equal(values.has("access_token"), false);
  assert.equal(auth.hasActiveSession(), false);
  assert.equal(requests, 0);
});

for (const result of ["success", "denied", "network-error"]) {
  test(`a late ${result} from A's refresh cannot modify B's session`, async () => {
    const refresh = deferred();
    let requests = 0;
    const { auth, login, values } = fixture((url) => {
      if (url.endsWith("/refresh")) return refresh.promise;
      requests++;
      return Promise.resolve({ status: 200 });
    });
    login("A", -60);
    const pending = auth.default("http://local-test/api/community/mine/");
    login("B");
    const accessB = values.get("access_token");
    if (result === "network-error") refresh.reject(new Error("offline"));
    else refresh.resolve(response(result === "success" ? jwt("A") : null));
    await assert.rejects(pending, sessionChanged);
    assert.equal(values.get("access_token"), accessB);
    assert.equal(requests, 0);
  });
}

test("a late 401 after switching accounts cannot replay a mutation as the new account", async () => {
  const network = deferred();
  const started = deferred();
  const requests = [];
  const { auth, login } = fixture((url, options) => {
    requests.push({ url, options });
    started.resolve();
    return network.promise;
  });
  login("A");
  const pending = auth.default("http://local-test/api/community/reviews/1/", { method: "POST", body: "{}" });
  await started.promise;
  login("B");
  network.resolve({ status: 401 });
  await assert.rejects(pending, sessionChanged);
  assert.equal(requests.length, 1);
});

test("a successful old response is discarded after account switch", async () => {
  const network = deferred();
  const started = deferred();
  const { auth, login } = fixture(() => { started.resolve(); return network.promise; });
  login("A");
  const pending = auth.default("http://local-test/api/community/mine/");
  await started.promise;
  login("B");
  network.resolve({ status: 200 });
  await assert.rejects(pending, sessionChanged);
});

test("the new account has its own refresh and the old completion cannot clear its flight", async () => {
  const refreshA = deferred(), refreshB = deferred();
  let refreshCount = 0;
  const requests = [];
  const { auth, login, values } = fixture((url, options) => {
    if (url.endsWith("/refresh")) return ++refreshCount === 1 ? refreshA.promise : refreshB.promise;
    requests.push(options.headers.Authorization);
    return Promise.resolve({ status: 200 });
  });
  login("A", -60);
  const old = auth.default("http://local-test/api/community/mine/");
  login("B", -60);
  const next = auth.default("http://local-test/api/community/mine/");
  refreshA.resolve(response(jwt("A")));
  await assert.rejects(old, sessionChanged);
  const next2 = auth.default("http://local-test/api/community/mine/");
  const accessB = jwt("B");
  refreshB.resolve(response(accessB));
  await Promise.all([next, next2]);
  assert.equal(refreshCount, 2);
  assert.equal(values.get("access_token"), accessB);
  assert.deepEqual(requests, [`Bearer ${accessB}`, `Bearer ${accessB}`]);
});

test("normal concurrent requests deduplicate refresh and preserve multipart headers", async () => {
  const refresh = deferred();
  let refreshCount = 0;
  const requests = [];
  const { auth, login } = fixture((url, options) => {
    if (url.endsWith("/refresh")) { refreshCount++; return refresh.promise; }
    requests.push(options);
    return Promise.resolve({ status: 200 });
  });
  login("A", -60);
  const form = new FormData();
  form.set("request_id", "test");
  const pending = [auth.default("http://local-test/api/one"), auth.default("http://local-test/api/two", { method: "POST", body: form })];
  refresh.resolve(response(jwt("A")));
  await Promise.all(pending);
  assert.equal(refreshCount, 1);
  assert.equal(requests[0].headers["Content-Type"], "application/json");
  assert.equal(requests[1].headers["Content-Type"], undefined);
  assert.equal(requests[1].body, form);
});

test("one request timing out does not cancel another request sharing its token refresh", async () => {
  const refresh = deferred();
  const requests = [];
  let refreshCount = 0;
  const { auth, login } = fixture((url, options) => {
    if (url.endsWith('/refresh')) { refreshCount++; return refresh.promise; }
    requests.push(options.headers.Authorization);
    return Promise.resolve({ status: 200 });
  });
  login('A', -60);
  const controller = new AbortController();
  const first = auth.default('http://local-test/api/one', { signal: controller.signal });
  const second = auth.default('http://local-test/api/two');
  controller.abort();
  await assert.rejects(first, error => error.name === 'AbortError');
  const access = jwt('A');
  refresh.resolve(response(access));
  assert.equal((await second).status, 200);
  assert.equal(refreshCount, 1);
  assert.deepEqual(requests, [`Bearer ${access}`]);
});

test("expired credentials are cleared while anonymous requests still work", async () => {
  const { auth, login, values } = fixture(async () => ({ status: 401 }));
  login("A", -60);
  values.set("refresh_token", jwt("A", -60));
  const result = await auth.default("http://local-test/api/community/mine/");
  assert.equal(result.status, 401);
  assert.equal(values.size, 0);
  assert.equal((await auth.default("http://local-test/api/public/")).status, 401);
});

test("ordinary 401 refreshes once and retries with a fresh token", async () => {
  let requestCount = 0, refreshCount = 0;
  const token = jwt("A", 600, "rotated");
  const { auth, login, values } = fixture(async (url, options) => {
    if (url.endsWith("/refresh")) { refreshCount++; return response(token); }
    requestCount++;
    if (requestCount === 1) return { status: 401 };
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return { status: 200 };
  });
  login("A");
  assert.equal((await auth.default("http://local-test/api/private/")).status, 200);
  assert.equal(requestCount, 2);
  assert.equal(refreshCount, 1);
  assert.equal(values.get("access_token"), token);
});

test("a second 401 from an old retry cannot log out the newly signed-in account", async () => {
  const retry = deferred(), started = deferred();
  let count = 0;
  const { auth, login, values } = fixture(async (url) => {
    if (url.endsWith("/refresh")) return response(jwt("A"));
    if (++count === 1) return { status: 401 };
    started.resolve();
    return retry.promise;
  });
  login("A");
  const pending = auth.default("http://local-test/api/private/");
  await started.promise;
  login("B");
  const tokenB = values.get("access_token");
  retry.resolve({ status: 401 });
  await assert.rejects(pending, sessionChanged);
  assert.equal(values.get("access_token"), tokenB);
});

test("storage events fence a logout and restored-token session from another tab", async () => {
  const refresh = deferred();
  const { auth, login, values, window } = fixture(() => refresh.promise);
  login("A", -60);
  const stored = new Map(values);
  const pending = auth.default("http://local-test/api/private/");
  values.clear();
  window.dispatchEvent(new Event("storage"));
  for (const [key, value] of stored) values.set(key, value);
  window.dispatchEvent(new Event("storage"));
  refresh.resolve(response(jwt("A")));
  await assert.rejects(pending, sessionChanged);
  assert.equal(values.get("access_token"), stored.get("access_token"));
});
