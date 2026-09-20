export const POSTER_TEMPLATES = {
  recruitment: "招募海报",
  introduction: "军团介绍",
  event: "活动宣传",
};

// Backgrounds are deliberately rendered locally so previews and downloaded
// posters never depend on a remote image host. Keep the keys stable: they are
// persisted in revision.content and are also used by the backend allow-list.
export const POSTER_BACKGROUNDS = {
  "deep-space": "深空星云",
  "ion-storm": "电离风暴",
  "tactical-grid": "战术网格",
  "jump-rift": "跃迁裂隙",
  "sovereignty-border": "主权边界",
  "pirate-tide": "海盗暗潮",
};

const BACKGROUND_FALLBACK = "deep-space";

export const normalizePosterBackground = (value) =>
  Object.hasOwn(POSTER_BACKGROUNDS, value) ? value : BACKGROUND_FALLBACK;

const backgroundGradient = (ctx, kind, args, stops, fallback) => {
  const factory = ctx?.[kind];
  if (typeof factory !== "function") return fallback;
  const gradient = factory.apply(ctx, args);
  if (!gradient || typeof gradient.addColorStop !== "function") return fallback;
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  return gradient;
};

const seeded = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

function stars(ctx, seed, count, color = "#d8e6ff", size = 2) {
  const random = seeded(seed);
  ctx.save?.();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    const x = random() * 1080;
    const y = random() * 1440;
    const radius = 0.5 + random() * size;
    ctx.globalAlpha = 0.2 + random() * 0.7;
    ctx.beginPath?.();
    ctx.arc?.(x, y, radius, 0, Math.PI * 2);
    ctx.fill?.();
  }
  ctx.restore?.();
}

function linePath(ctx, points, color, width = 2, alpha = 1, dashed = false) {
  ctx.save?.();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  if (dashed && typeof ctx.setLineDash === "function") ctx.setLineDash([12, 14]);
  ctx.beginPath?.();
  points.forEach(([x, y], index) => {
    if (index) ctx.lineTo?.(x, y);
    else ctx.moveTo?.(x, y);
  });
  ctx.stroke?.();
  ctx.restore?.();
}

function contrastOverlay(ctx) {
  const overlay = backgroundGradient(
    ctx,
    "createLinearGradient",
    [0, 240, 0, 1440],
    [
      [0, "#05081212"],
      [0.48, "#05081235"],
      [1, "#050812b8"],
    ],
    "#07101c66",
  );
  ctx.save?.();
  ctx.fillStyle = overlay;
  ctx.fillRect?.(0, 0, 1080, 1440);
  ctx.restore?.();
}

/**
 * Draw one of the six deterministic backgrounds. The function intentionally
 * uses only Canvas 2D primitives, seeded geometry and fixed colors, making it
 * safe to call repeatedly for export and preview without visual drift.
 */
export function drawPosterBackground(ctx, background = BACKGROUND_FALLBACK, template) {
  const key = normalizePosterBackground(background);
  const intro = template === "introduction";
  const palette = {
    "deep-space": {
      base: "#091225",
      gradient: [
        [0, "#314a91"],
        [0.48, "#161f52"],
        [1, "#080c1b"],
      ],
    },
    "ion-storm": {
      base: "#061d2a",
      gradient: [
        [0, "#1a8e9a"],
        [0.42, "#0b3b57"],
        [1, "#04111d"],
      ],
    },
    "tactical-grid": {
      base: "#080e15",
      gradient: [
        [0, "#203d4a"],
        [0.4, "#101c2c"],
        [1, "#05080d"],
      ],
    },
    "jump-rift": {
      base: "#160c26",
      gradient: [
        [0, "#674093"],
        [0.42, "#301b66"],
        [1, "#0b071b"],
      ],
    },
    "sovereignty-border": {
      base: "#071a2a",
      gradient: [
        [0, "#1b5071"],
        [0.44, "#132d4f"],
        [1, "#06101f"],
      ],
    },
    "pirate-tide": {
      base: "#1a0b12",
      gradient: [
        [0, "#8b3d43"],
        [0.42, "#421d2a"],
        [1, "#0d070c"],
      ],
    },
  }[key];

  ctx.fillStyle = palette.base;
  ctx.fillRect?.(0, 0, 1080, 1440);
  const glow = backgroundGradient(
    ctx,
    "createRadialGradient",
    [790, 240, 20, 790, 240, 940],
    palette.gradient,
    palette.base,
  );
  ctx.fillStyle = glow;
  ctx.fillRect?.(0, 0, 1080, 1440);

  if (key === "deep-space") {
    stars(ctx, 0x2a8f, 90, "#d9e9ff", 2.4);
    ctx.save?.();
    ctx.strokeStyle = "#8eafff55";
    ctx.lineWidth = 2;
    [220, 350, 500].forEach((radius) => {
      ctx.beginPath?.();
      ctx.arc?.(820, 250, radius, -0.85, Math.PI * 1.42);
      ctx.stroke?.();
    });
    ctx.restore?.();
  } else if (key === "ion-storm") {
    stars(ctx, 0x1c04, 54, "#b9f8ff", 2.1);
    for (let i = 0; i < 10; i += 1) {
      const points = [];
      for (let j = 0; j < 7; j += 1)
        points.push([80 + j * 180, 270 + i * 100 + Math.sin(i + j) * 34]);
      linePath(ctx, points, i % 2 ? "#64ecf4" : "#c2ffff", 2 + (i % 3), 0.18, false);
    }
    ctx.save?.();
    ctx.strokeStyle = "#8ffaff88";
    ctx.lineWidth = 12;
    ctx.beginPath?.();
    ctx.arc?.(805, 300, 310, -0.3, 1.2);
    ctx.stroke?.();
    ctx.restore?.();
  } else if (key === "tactical-grid") {
    ctx.save?.();
    ctx.strokeStyle = "#57cfe035";
    ctx.lineWidth = 1;
    for (let x = 54; x < 1080; x += 54) {
      ctx.beginPath?.();
      ctx.moveTo?.(x, 0);
      ctx.lineTo?.(x, 1440);
      ctx.stroke?.();
    }
    for (let y = 54; y < 1440; y += 54) {
      ctx.beginPath?.();
      ctx.moveTo?.(0, y);
      ctx.lineTo?.(1080, y);
      ctx.stroke?.();
    }
    ctx.strokeStyle = "#9aeaf088";
    ctx.lineWidth = 2;
    ctx.beginPath?.();
    ctx.arc?.(840, 280, 250, 0, Math.PI * 2);
    ctx.stroke?.();
    ctx.restore?.();
    for (let y = 100; y < 1440; y += 18) {
      ctx.fillStyle = "#7ee7e710";
      ctx.fillRect?.(0, y, 1080, 1);
    }
  } else if (key === "jump-rift") {
    stars(ctx, 0x7f11, 66, "#e9d7ff", 2.5);
    for (let i = 0; i < 16; i += 1) {
      const offset = i * 42;
      linePath(
        ctx,
        [
          [130 + offset, 1400],
          [480 + offset * 0.55, 740],
          [770 + offset * 0.25, 150],
        ],
        i % 2 ? "#ffad5b" : "#d99cff",
        2 + (i % 2),
        0.28,
      );
    }
    const rift = backgroundGradient(
      ctx,
      "createRadialGradient",
      [535, 700, 10, 535, 700, 430],
      [
        [0, "#fff2d4"],
        [0.08, "#ffb86c"],
        [0.3, "#bd5af188"],
        [1, "#160b2a00"],
      ],
      "#7c3c9688",
    );
    ctx.fillStyle = rift;
    ctx.fillRect?.(0, 0, 1080, 1440);
  } else if (key === "sovereignty-border") {
    stars(ctx, 0x550d, 58, "#ffe5a6", 2.2);
    const boundary = [
      [90, 390],
      [320, 215],
      [590, 300],
      [850, 190],
      [1000, 450],
      [860, 700],
      [560, 610],
      [300, 760],
      [90, 390],
    ];
    linePath(ctx, boundary, "#e3b964", 3, 0.72, true);
    ctx.fillStyle = "#f8d680";
    boundary.slice(0, -1).forEach(([x, y]) => {
      ctx.beginPath?.();
      ctx.arc?.(x, y, 6, 0, Math.PI * 2);
      ctx.fill?.();
    });
    ctx.save?.();
    ctx.strokeStyle = "#d5a95250";
    ctx.lineWidth = 3;
    ctx.beginPath?.();
    ctx.arc?.(740, 300, 360, -1.1, 1.75);
    ctx.stroke?.();
    ctx.restore?.();
  } else if (key === "pirate-tide") {
    stars(ctx, 0x9109, 48, "#ffcfb1", 1.9);
    for (let i = 0; i < 6; i += 1) {
      linePath(
        ctx,
        [
          [30, 220 + i * 165],
          [250, 120 + i * 150],
          [500, 280 + i * 92],
          [780, 170 + i * 135],
          [1060, 330 + i * 120],
        ],
        i % 2 ? "#df6b50" : "#e5b161",
        2,
        0.46,
        true,
      );
    }
    ctx.save?.();
    ctx.strokeStyle = "#ee765e88";
    ctx.lineWidth = 4;
    ctx.beginPath?.();
    ctx.moveTo?.(80, 1120);
    ctx.lineTo?.(280, 980);
    ctx.lineTo?.(420, 1120);
    ctx.lineTo?.(620, 970);
    ctx.stroke?.();
    ctx.restore?.();
  }
  // A fixed readability wash keeps text legible over bright glows and cover art.
  contrastOverlay(ctx);
  if (intro) {
    ctx.fillStyle = "#02050c20";
    ctx.fillRect?.(0, 0, 1080, 1440);
  }
  return key;
}

export function wrapPosterText(text, measure, width, maxLines) {
  if (!text || maxLines < 1 || width < 1) return [];
  const lines = [];
  let line = "";
  let overflow = false;
  const chars = [...String(text).replace(/\r/g, "")];
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
  return `${safe}-${POSTER_TEMPLATES[template] || "海报"}${approved ? "" : "-未审核"}.png`;
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
    color = "#ece9e1",
    width = 912,
    lines = 2,
    lineHeight = 1.5,
  } = {},
) {
  ctx.font = `${weight} ${size}px ${FONT}`;
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
  return wrapped.length * size * lineHeight;
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
function line(ctx, x, y, width, color = "#4a4b46") {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, 1);
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

const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const cappedLabels = (values, labels, limit) => {
  const valuesList = list(values);
  const visible = valuesList
    .map((value) => labels[value] || String(value))
    .slice(0, limit);
  const rest = Math.max(0, valuesList.length - visible.length);
  if (rest) visible.push(`等${rest}项`);
  return visible;
};

function metadataLine(content) {
  const types = cappedLabels(content.corp_types, CORP_TYPE_LABELS, 2);
  const regions = cappedLabels(content.region_tags, REGION_LABELS, 3);
  const alliance = content.alliance ? [`联盟 · ${content.alliance}`] : [];
  return [...types, ...regions, ...alliance].join("  /  ");
}

function welfareLine(content) {
  const labels = cappedLabels(content.benefit_keys, BENEFIT_LABELS, 4);
  const note = content.benefits_note ? String(content.benefits_note) : "";
  const legacy = content.benefits ? String(content.benefits) : "";
  return [...labels, note, legacy].filter(Boolean).join(" · ");
}

/** Draw one bounded portrait; callers supply only server-controlled decoded images. */
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
  const selectedTemplate = POSTER_TEMPLATES[template] ? template : "recruitment";
  const intro = selectedTemplate === "introduction";
  const event = selectedTemplate === "event";
  const background = normalizePosterBackground(content.poster_background);
  drawPosterBackground(ctx, background, selectedTemplate);
  // All selectable backgrounds are dark enough for a light ink system. The
  // readability wash in drawPosterBackground keeps cover art and glows legible.
  const ink = "#f1f4f8";
  const muted = "#c2ccd7";
  const accent =
    background === "pirate-tide"
      ? "#f1ad76"
      : background === "sovereignty-border"
        ? "#f2d082"
        : event
          ? "#a9e5ec"
          : "#bdc9ff";
  ctx.strokeStyle = "#b8c6dc22";
  ctx.lineWidth = 1;
  for (let x = 60; x < 1080; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1440);
    ctx.stroke();
  }
  // Restrained orbital motif, generated as layout geometry, never a fake game asset.
  ctx.save();
  ctx.strokeStyle = "#b8c6dc42";
  ctx.lineWidth = 2;
  for (const radius of [220, 340, 460]) {
    ctx.beginPath();
    ctx.arc(1030, 140, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  text(
    ctx,
    `EVEM  /  ${event ? "FLEET EVENT" : intro ? "CORPORATION" : "RECRUITMENT"}`,
    84,
    65,
    { size: 21, color: muted, lines: 1 },
  );
  text(
    ctx,
    `${shortName || "CORP"}  ·  ${POSTER_TEMPLATES[selectedTemplate]}`,
    84,
    120,
    { size: 27, color: accent, lines: 1 },
  );
  if (images.logo) cover(ctx, images.logo, 884, 115, 112, 112);
  text(ctx, event ? content.event_title || "下一程，一起出发" : name, 80, 233, {
    size: event ? 72 : 82,
    weight: 700,
    color: ink,
    width: 912,
    lines: 2,
    lineHeight: 1.22,
  });
  text(ctx, event ? name : content.tagline || "在新伊甸，与你并肩。", 84, 446, {
    size: 31,
    color: muted,
    width: 900,
    // Keep the metadata rail and cover start aligned even when a user enters
    // a very long slogan; the ellipsis is clearer than overlapping rows.
    lines: 1,
  });
  const metadata = metadataLine(content);
  if (metadata)
    text(ctx, metadata, 84, 515, {
      size: 21,
      color: accent,
      width: 900,
      lines: 1,
    });
  if (images.cover) cover(ctx, images.cover, 84, 565, 912, 330);
  else {
    ctx.fillStyle = "#172536cc";
    ctx.fillRect(84, 565, 912, 330);
    line(ctx, 132, 750, 800, "#7890a455");
    text(
      ctx,
      event
        ? content.event_time || "集结时间待定"
        : intro
          ? "每一次跃迁，都有同伴。"
          : "YOUR NEXT CHAPTER",
      130,
      621,
      { size: event ? 43 : 39, weight: 600, color: ink, width: 820, lines: 2 },
    );
    text(
      ctx,
      event
        ? content.event_location || "联系军团确认集结地点"
        : content.base_region || "新伊甸",
      132,
      784,
      { size: 27, color: muted, width: 800, lines: 2 },
    );
  }
  if (!event && !intro) {
    text(ctx, "军团支持", 84, 940, {
      size: 22,
      weight: 600,
      color: accent,
      lines: 1,
      width: 420,
    });
    text(ctx, "期待这样的你", 568, 940, {
      size: 22,
      weight: 600,
      color: accent,
      lines: 1,
      width: 428,
    });
    text(ctx, welfareLine(content) || "欢迎联系军团了解。", 84, 990, {
      size: 30,
      color: ink,
      width: 420,
      lines: 4,
    });
    text(ctx, content.requirements || "欢迎友善的同行者。", 568, 990, {
      size: 30,
      color: ink,
      width: 428,
      lines: 4,
    });
  } else {
    text(ctx, event ? "活动简报" : "关于我们", 84, 940, {
      size: 22,
      weight: 600,
      color: intro ? "#8a6c47" : accent,
      lines: 1,
    });
    text(
      ctx,
      (event ? content.event_description : content.introduction) ||
        "更多详情，欢迎联系军团了解。",
      84,
      990,
      { size: 32, color: ink, width: 912, lines: 4, lineHeight: 1.5 },
    );
  }
  line(ctx, 84, 1220, 912, intro ? "#c7c3b8" : "#4a5758");
  text(
    ctx,
    event
      ? `${content.event_time || ""}  ${content.event_location || ""}`
      : content.active_time || "欢迎联系了解活跃时间",
    84,
    1250,
    { size: 22, color: muted, width: 912, lines: 1 },
  );
  text(ctx, content.public_contact || "联系方式待补充", 84, 1300, {
    size: 26,
    weight: 600,
    color: ink,
    width: 912,
    lines: 2,
    lineHeight: 1.35,
  });
  if (!approved) {
    ctx.fillStyle = "#a6533e";
    ctx.fillRect(0, 1390, 1080, 50);
    text(ctx, "未审核 · 内容由军团编辑提供，仅作预览", 84, 1401, {
      size: 22,
      color: "#fff",
      lines: 1,
    });
  } else
    text(
      ctx,
      "EVEM TOOLKITS  /  军团资料已审核，活动信息请向军团确认",
      84,
      1400,
      { size: 18, color: muted, lines: 1 },
    );
}
