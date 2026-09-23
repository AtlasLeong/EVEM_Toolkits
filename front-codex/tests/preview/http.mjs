import { resolvePreviewRequest } from "./fixtures.mjs";
import { createCommunitySandbox } from "./community.mjs";
import sharp from "sharp";
import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const invalid = (message = "请求内容无效。", status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const maxBytes = 5 * 1024 * 1024;
// Match the production upload policy, but keep all I/O in memory. Calling
// toBuffer is intentional: metadata alone does not prove an image decodes.
async function sanitizedImage(bytes, type, filename) {
  const expected = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" }[
    String(filename).split(".").pop().toLowerCase()
  ];
  if (!expected || type !== `image/${expected}`)
    invalid("图片格式与文件后缀不符。");
  try {
    const decoder = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 20_000_000,
    });
    const metadata = await decoder.metadata();
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 20_000_000 ||
      (metadata.pages || 1) !== 1
    )
      invalid("图片无效、含动画或像素超过 2000 万。");
    // Some libvips builds decode APNG's default image without reporting pages.
    // Read its bounded acTL chunk so a multi-frame PNG cannot pass as a still.
    if (metadata.format === "png") {
      let animationFrames = null;
      let sawFrameControl = false;
      let sawImageData = false;
      let independentDefaultFrame = 0;
      for (let cursor = 8; cursor + 12 <= bytes.length;) {
        const length = bytes.readUInt32BE(cursor);
        if (cursor + length + 12 > bytes.length) invalid("PNG 图片不完整。");
        const kind = bytes.toString("ascii", cursor + 4, cursor + 8);
        if (kind === "acTL") {
          if (length !== 8 || animationFrames !== null)
            invalid("PNG 动画声明无效。");
          animationFrames = bytes.readUInt32BE(cursor + 8);
        }
        if (kind === "fcTL") sawFrameControl = true;
        if (kind === "IDAT" && !sawImageData) {
          // APNG excludes a separate default image from acTL.num_frames.
          // Its IDAT precedes fcTL, unlike a default image that is frame one.
          independentDefaultFrame = sawFrameControl ? 0 : 1;
          sawImageData = true;
        }
        cursor += length + 12;
      }
      if (
        animationFrames !== null &&
        (animationFrames < 1 || animationFrames + independentDefaultFrame !== 1)
      )
        invalid("不支持动画图片。");
    }
    const { data, info } = await decoder
      .autoOrient()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > maxBytes) invalid("转换后的图片超过 5 MiB。");
    return {
      width: info.width,
      height: info.height,
      type: "image/webp",
      hash: createHash("sha256").update(bytes).digest("hex"),
      bytes: data,
      validated: true,
    };
  } catch {
    invalid("图片无效、格式不符、含动画或像素超过 2000 万。");
  }
}

export function createSandboxMiddleware() {
  const community = createCommunitySandbox();
  const secret = randomBytes(32);
  const sign = (role, kind) => {
    // AuthContext's legacy JWT decoder uses atob directly: ASCII-escape Unicode
    // while retaining valid standard JSON so demo Chinese names display correctly.
    const encode = (value) =>
      Buffer.from(
        JSON.stringify(value).replace(
          /[\u007f-\uffff]/g,
          (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
        ),
      ).toString("base64url");
    const payload = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ userId: role === "owner" ? 101 : 102, userName: role === "owner" ? "演示军团管理员" : "演示审核员", email: `${role}@preview.invalid`, role, kind, exp: Math.floor(Date.now() / 1000) + (kind === "refresh" ? 86400 : 3600), nonce: randomBytes(8).toString("hex") })}`;
    return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  };
  const verify = (token, kind) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const signature = Buffer.from(parts[2], "base64url");
      const expected = createHmac("sha256", secret)
        .update(`${parts[0]}.${parts[1]}`)
        .digest();
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected)
      )
        return null;
      const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
      return payload.kind === kind &&
        payload.exp > Date.now() / 1000 &&
        ["owner", "reviewer"].includes(payload.role)
        ? payload.role
        : null;
    } catch {
      return null;
    }
  };
  return async function middleware(req, res) {
    try {
      const host = req.headers.host || "";
      if (!/^127\.0\.0\.1:\d+$/.test(host))
        invalid("沙盒仅允许本机访问。", 403);
      const origin = `http://${host}`,
        url = new URL(req.url, origin);
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers.origin &&
        req.headers.origin !== origin
      )
        invalid("拒绝外部网站修改本地沙盒。", 403);
      const role =
        verify(
          (req.headers.authorization || "").replace(/^Bearer /, ""),
          "access",
        ) || "guest";
      const contentType = req.headers["content-type"] || "";
      if (contentType.startsWith("multipart/form-data")) {
        const target = url.pathname.match(
          /^\/api\/community\/corporations\/(\d+)\/media\/$/,
        );
        if (!target || req.method !== "POST") invalid("此接口不接受文件上传。");
        if (role === "guest") invalid("请先选择演示身份。", 401);
        const management = community(
          new URL(`/api/community/corporations/${target[1]}/manage/`, origin),
          "GET",
          {},
          { role },
        );
        if (management.status !== 200 || !management.data.can_edit)
          invalid("军团不存在或没有管理权限。", 404);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes + 65536) invalid("请求超过本地沙盒大小限制。", 413);
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      let body = {};
      if (raw.length && contentType.startsWith("multipart/form-data")) {
        const form = await new Response(raw, {
          headers: { "Content-Type": contentType },
        }).formData();
        if (
          [...form.keys()].length !== 2 ||
          form.getAll("file").length !== 1 ||
          form.getAll("request_id").length !== 1 ||
          typeof form.get("request_id") !== "string"
        )
          invalid("图片上传字段无效。");
        const file = form.get("file");
        if (
          !file ||
          typeof file.arrayBuffer !== "function" ||
          file.size === 0 ||
          file.size > maxBytes
        )
          invalid("每张图片需在 5 MiB 以内。");
        body = {
          request_id: form.get("request_id"),
          file: await sanitizedImage(
            Buffer.from(await file.arrayBuffer()),
            file.type,
            file.name,
          ),
        };
      } else if (raw.length) {
        if (raw.length > 1000000 || !contentType.startsWith("application/json"))
          invalid("请求格式无效。");
        body = JSON.parse(raw.toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
      }
      let result;
      if (url.pathname === "/api/_preview/session" && req.method === "POST") {
        if (
          !["owner", "reviewer", "guest"].includes(body.role) ||
          Object.keys(body).length !== 1
        )
          invalid("请选择有效演示身份。");
        result = {
          status: 200,
          data:
            body.role === "guest"
              ? { role: "guest" }
              : {
                  role: body.role,
                  access: sign(body.role, "access"),
                  refresh: sign(body.role, "refresh"),
                },
        };
      } else if (
        url.pathname === "/api/user/token/refresh" &&
        req.method === "POST"
      ) {
        const refreshRole = verify(body.refresh, "refresh");
        if (!refreshRole) invalid("演示会话已失效，请重新选择演示身份。", 401);
        result = { status: 200, data: { access: sign(refreshRole, "access") } };
      } else if (
        /^\/api\/user\/(login|fraudlogin|signup|signupcheck|reset)/.test(
          url.pathname,
        )
      ) {
        result = {
          status: 400,
          data: {
            error: "本地沙盒不使用真实密码，请点击页面顶部的演示身份入口。",
          },
        };
      } else if (url.pathname.startsWith("/api/community/"))
        result = community(url, req.method, body, { role });
      else result = resolvePreviewRequest(url, req.method, body);
      res.statusCode = result.status;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (result.bytes) {
        res.setHeader("Content-Type", result.contentType);
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.end(result.bytes);
      } else {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(result.data));
      }
    } catch (error) {
      res.statusCode = error.status || 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          detail: error.status ? error.message : "请求内容无效。",
        }),
      );
    }
  };
}
