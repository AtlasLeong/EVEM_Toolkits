import { activityKind, activityLabels } from "./corporationActivity.js";

export const POSTER_TEMPLATES = {
  recruitment: "招募海报",
  introduction: "军团介绍",
  event: "主要活动",
};

export const POSTER_BACKGROUNDS = {
  "expedition-fleet": "远征舰队",
  "ringed-planet": "星环巨行星",
  "spiral-galaxy": "旋臂星河",
  "orbital-shipyard": "轨道船坞",
  "black-hole": "黑洞视界",
  "stellar-nursery": "创生星云",
  "frozen-frontier": "冰封边境",
  wreckfield: "战舰残骸",
};

const LEGACY_BACKGROUNDS = {
  "deep-space": "spiral-galaxy",
  "ion-storm": "stellar-nursery",
  "tactical-grid": "orbital-shipyard",
  "jump-rift": "black-hole",
  "sovereignty-border": "ringed-planet",
  "pirate-tide": "wreckfield",
};

export function normalizePosterBackground(value) {
  if (typeof value !== "string") return "expedition-fleet";
  if (Object.hasOwn(POSTER_BACKGROUNDS, value)) return value;
  return Object.hasOwn(LEGACY_BACKGROUNDS, value)
    ? LEGACY_BACKGROUNDS[value]
    : "expedition-fleet";
}

function cover(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.drawImage(
    image,
    x + (width - image.width * scale) / 2,
    y + (height - image.height * scale) / 2,
    image.width * scale,
    image.height * scale,
  );
  ctx.restore();
}

function wash(ctx, y, height, stops) {
  const gradient = ctx.createLinearGradient(0, y, 0, y + height);
  // Lightweight test contexts need not implement CanvasGradient.
  if (!gradient?.addColorStop) return;
  for (const [position, color] of stops) gradient.addColorStop(position, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y, 1080, height);
}

/** Only decoded, bundled artwork is accepted; a missing asset must block export. */
export function drawPosterBackground(ctx, background, artwork) {
  if (!artwork?.width || !artwork?.height)
    throw new Error("海报背景尚未加载，请重试");
  cover(ctx, artwork, 0, 0, 1080, 1440);
  // Local contrast treatments leave the central scene unobstructed.
  wash(ctx, 0, 610, [
    [0, "#080c14ee"],
    [0.82, "#080c14bf"],
    [1, "#080c1400"],
  ]);
  wash(ctx, 820, 620, [
    [0, "#080c1400"],
    [0.23, "#080c14cd"],
    [0.58, "#080c14f2"],
    [1, "#080c14"],
  ]);
  return normalizePosterBackground(background);
}

export function wrapPosterText(value, measure, width, maxLines) {
  if (!value || maxLines < 1 || width < 1) return [];
  const lines = [];
  let line = "";
  let overflow = false;
  const chars = [...String(value).replace(/\r/g, "")];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === "\n" || (line && measure(line + char) > width)) {
      lines.push(line);
      line = "";
      if (lines.length === maxLines) {
        overflow = char !== "\n" || i < chars.length - 1;
        break;
      }
      if (char === "\n") continue;
    }
    line += char;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (overflow && lines.length) {
    let tail = lines.at(-1);
    while (tail && measure(tail + "…") > width)
      tail = [...tail].slice(0, -1).join("");
    lines[lines.length - 1] = tail + "…";
  }
  return lines;
}

export function posterFilename(name, template, approved) {
  const safe =
    String(name || "军团")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 60) || "军团";
  return (
    safe +
    "-" +
    (POSTER_TEMPLATES[template] || "海报") +
    (approved ? "" : "-未审核") +
    ".png"
  );
}

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
function text(
  ctx,
  value,
  x,
  y,
  {
    size = 30,
    weight = 400,
    color = "#f4f3ef",
    width = 920,
    lines = 2,
    lineHeight = 1.5,
  } = {},
) {
  ctx.font = weight + " " + size + "px " + FONT;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  const wrapped = wrapPosterText(
    value,
    (s) => ctx.measureText(s).width,
    width,
    lines,
  );
  wrapped.forEach((line, index) =>
    ctx.fillText(line, x, y + index * size * lineHeight),
  );
}

const CORP_TYPE_LABELS = { pirate: "海盗", sovereignty: "主权" };
const REGION_LABELS = { highsec: "高安", lowsec: "低安", nullsec: "00地区" };
const BENEFIT_LABELS = {
  ship_reimbursement: "舰船补损",
  fleet_training: "舰队培训",
  industry_support: "工业/生产支持",
  logistics_support: "物流支持",
  newbro_mentoring: "新人导师",
  skill_sharing: "技能/知识分享",
  pve_fleet: "PVE舰队",
  pvp_fleet: "PVP舰队",
};
const labels = (values, names, limit) => {
  const items = Array.isArray(values)
    ? values.filter((v) => Object.hasOwn(names, v))
    : [];
  return [
    ...items.slice(0, limit).map((v) => names[v]),
    ...(items.length > limit ? ["等" + (items.length - limit) + "项"] : []),
  ];
};
const locationText = (content) => {
  const location = content.base_location;
  return (
    [
      location?.region_name,
      location?.constellation_name,
      location?.solarsystem_name,
    ]
      .filter(Boolean)
      .join(" / ") ||
    content.base_region ||
    "新伊甸"
  );
};

/** Draw a bounded, print-ready portrait. Images are decoded by PosterStudio. */
export function drawCorporationPoster(
  canvas,
  { name, short_name: shortName },
  content = {},
  template,
  approved,
  images = {},
) {
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持海报绘制");
  const selected = Object.hasOwn(POSTER_TEMPLATES, template)
    ? template
    : "recruitment";
  const event = selected === "event";
  const legacyEvent = event && activityKind(content) === "legacy_event";
  const intro = selected === "introduction";
  const background = drawPosterBackground(
    ctx,
    content.poster_background,
    images.background,
  );
  const warm = [
    "ringed-planet",
    "orbital-shipyard",
    "black-hole",
    "wreckfield",
  ].includes(background);
  const accent = warm ? "#e8c6a2" : "#b8dadd";
  const muted = "#d1d7dd";

  text(
    ctx,
    (shortName || "CORP") +
      " · " +
      (legacyEvent ? "旧版活动资料" : POSTER_TEMPLATES[selected]),
    80,
    109,
    { size: 25, color: accent, lines: 1, width: 750 },
  );
  if (images.logo) cover(ctx, images.logo, 904, 58, 96, 96);
  text(
    ctx,
    legacyEvent ? content.event_title || "下一程，一起出发" : name,
    76,
    202,
    {
      size: legacyEvent ? 68 : 78,
      weight: 700,
      width: 924,
      lines: 2,
      lineHeight: 1.22,
    },
  );
  text(
    ctx,
    legacyEvent ? name : content.tagline || "在新伊甸，与你并肩。",
    80,
    408,
    { size: 30, color: muted, lines: 1 },
  );
  const metadata = [
    ...labels(content.corp_types, CORP_TYPE_LABELS, 2),
    ...labels(content.region_tags, REGION_LABELS, 3),
    ...(content.alliance ? ["联盟 · " + content.alliance] : []),
  ].join(" / ");
  text(ctx, metadata, 80, 466, { size: 21, color: accent, lines: 1 });
  if (event && !legacyEvent) {
    const tags = activityLabels(
      content.activities,
      content.custom_activity_tags,
    );
    const summary = [
      ...tags.slice(0, 4),
      ...(tags.length > 4 ? [`等 ${tags.length - 4} 项`] : []),
    ];
    text(ctx, summary.join(" · "), 80, 510, {
      size: 23,
      color: accent,
      lines: 1,
    });
  }

  // Optional corporation photography is framed narrowly; no fallback block.
  if (images.cover) {
    cover(ctx, images.cover, 700, 678, 300, 168);
    ctx.strokeStyle = "#ffffff66";
    ctx.lineWidth = 2;
    ctx.strokeRect(700, 678, 300, 168);
  }

  text(
    ctx,
    legacyEvent
      ? content.event_location || "联系军团确认集结地点"
      : locationText(content),
    80,
    886,
    { size: 22, color: accent, lines: 1 },
  );
  if (!event && !intro) {
    text(ctx, "军团支持", 80, 946, {
      size: 22,
      weight: 600,
      color: accent,
      lines: 1,
      width: 420,
    });
    text(ctx, "期待这样的你", 570, 946, {
      size: 22,
      weight: 600,
      color: accent,
      lines: 1,
      width: 430,
    });
    const welfare = [
      ...labels(content.benefit_keys, BENEFIT_LABELS, 4),
      content.benefits_note,
      content.benefits,
    ]
      .filter(Boolean)
      .join(" · ");
    text(ctx, welfare || "欢迎联系军团了解。", 80, 991, {
      size: 29,
      width: 420,
      lines: 4,
    });
    text(ctx, content.requirements || "欢迎友善的同行者。", 570, 991, {
      size: 29,
      width: 430,
      lines: 4,
    });
  } else {
    text(
      ctx,
      event ? (legacyEvent ? "旧版活动说明" : "主要活动") : "关于我们",
      80,
      946,
      { size: 22, weight: 600, color: accent, lines: 1 },
    );
    text(
      ctx,
      (event
        ? legacyEvent
          ? content.event_description
          : content.activity_description
        : content.introduction) || "更多详情，欢迎联系军团了解。",
      80,
      991,
      { size: 30, lines: 4 },
    );
  }
  ctx.fillStyle = "#ffffff36";
  ctx.fillRect(80, 1214, 920, 1);
  text(
    ctx,
    legacyEvent
      ? content.event_time || "集结时间待定"
      : content.active_time || "欢迎联系了解活跃时间",
    80,
    1244,
    { size: 22, color: muted, lines: 1 },
  );
  text(ctx, content.public_contact || "联系方式待补充", 80, 1290, {
    size: 27,
    weight: 600,
    lines: 2,
    lineHeight: 1.3,
  });
  if (!approved) {
    ctx.fillStyle = "#934c3c";
    ctx.fillRect(0, 1390, 1080, 50);
    text(ctx, "未审核 · 内容由军团编辑提供，仅作预览", 80, 1401, {
      size: 22,
      lines: 1,
    });
  }
}
