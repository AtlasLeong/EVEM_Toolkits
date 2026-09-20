export const POSTER_TEMPLATES = {
  recruitment: "招募海报",
  introduction: "军团介绍",
  event: "活动宣传",
};

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

/** Draw one bounded portrait; callers supply only server-controlled decoded images. */
export function drawCorporationPoster(
  canvas,
  { name, short_name: shortName },
  content,
  template,
  approved,
  images = {},
) {
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持海报绘制");
  const intro = template === "introduction";
  const event = template === "event";
  const paper = intro ? "#f0ede5" : "#1f2527";
  const ink = intro ? "#252925" : "#f1eee6";
  const muted = intro ? "#66685d" : "#babdb6";
  const accent = event ? "#aec6ce" : "#c6b792";
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 1080, 1440);
  ctx.strokeStyle = intro ? "#d6d4ca" : "#373f40";
  ctx.lineWidth = 1;
  for (let x = 60; x < 1080; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1440);
    ctx.stroke();
  }
  // Restrained orbital motif, generated as layout geometry, never a fake game asset.
  ctx.save();
  ctx.strokeStyle = intro ? "#ddd8cb" : "#384347";
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
    `${shortName || "CORP"}  ·  ${POSTER_TEMPLATES[template]}`,
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
    lines: 2,
  });
  if (images.cover) cover(ctx, images.cover, 84, 565, 912, 330);
  else {
    ctx.fillStyle = intro ? "#dfdccf" : "#2d3739";
    ctx.fillRect(84, 565, 912, 330);
    line(ctx, 132, 750, 800, intro ? "#b8b6a8" : "#536263");
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
    text(ctx, content.benefits || "欢迎联系军团了解。", 84, 990, {
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
