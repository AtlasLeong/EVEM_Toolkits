export const KINDS = { battle: "战报", story: "趣闻", announcement: "活动" };
export const STATES = {
  draft: "草稿",
  pending: "审核中",
  approved: "已发布",
  rejected: "已退回",
  withdrawn: "已撤回",
};
export const SHIP_CLASSES = [
  "护卫舰",
  "驱逐舰",
  "巡洋舰",
  "战列巡洋舰",
  "战列舰",
  "工业舰",
  "采矿驳船",
  "航空母舰",
  "无畏舰",
  "超级航母",
  "泰坦",
  "其他",
];
export const newLoss = () => ({
  ship_id: null,
  ship_name: "",
  ship_class: "战列舰",
  quantity: 1,
});
export const newContent = () => ({
  kind: "battle",
  title: "",
  body: "",
  occurred_at: null,
  location: null,
  corporation_id: null,
  images: [],
  battle: {
    sides: ["A方", "B方"].map((name) => ({ name, isk_loss: null, losses: [] })),
  },
});
export function battleSummary(battle) {
  return {
    sides: (battle?.sides || []).map((side) => {
      const counts = new Map();
      for (const row of side.losses || [])
        counts.set(
          row.ship_class || "其他",
          (counts.get(row.ship_class || "其他") || 0) +
            (Number(row.quantity) || 0),
        );
      return {
        name: side.name,
        total_ships: [...counts.values()].reduce((a, b) => a + b, 0),
        by_class: [...counts].map(([name, quantity]) => ({ name, quantity })),
        isk_loss:
          side.isk_loss === "" || side.isk_loss == null
            ? null
            : String(side.isk_loss),
      };
    }),
  };
}
export function battleVisualSummary(battle) {
  const summary = (battle?.sides || []).some((side) =>
    Object.prototype.hasOwnProperty.call(side || {}, "total_ships"),
  )
    ? {
        sides: (battle.sides || []).map((side) => ({
          name: side.name,
          total_ships: Number(side.total_ships) || 0,
          by_class: Array.isArray(side.by_class) ? side.by_class : [],
          isk_loss:
            side.isk_loss === "" || side.isk_loss == null
              ? null
              : String(side.isk_loss),
        })),
      }
    : battleSummary(battle),
    total_ships = summary.sides.reduce((total, side) => total + side.total_ships, 0),
    leading_side = summary.sides.reduce(
      (winner, side, index) =>
        winner == null || side.total_ships > summary.sides[winner].total_ships
          ? index
          : winner,
      null,
    );
  return {
    sides: summary.sides.map((side) => ({
      ...side,
      share: total_ships ? Number((side.total_ships / total_ships).toFixed(4)) : 0,
    })),
    total_ships,
    leading_side,
  };
}
export function parseLossList(value) {
  const rows = [],
    errors = [];
  String(value)
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      const pieces = line
        .trim()
        .split(/[,，\t]/.test(line) ? /[,，\t]+/ : /\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
      const quantity = Number(pieces.at(-1));
      if (
        pieces.length !== 3 ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100000 ||
        pieces[0].length > 80 ||
        pieces[1].length > 120
      ) {
        errors.push(
          `第 ${index + 1} 行：请使用「舰种,型号,数量」，数量为 1–100000。`,
        );
        return;
      }
      rows.push({
        ship_id: null,
        ship_name: ["未知", "未知型号", "-"].includes(pieces[1])
          ? ""
          : pieces[1],
        ship_class: pieces[0],
        quantity,
      });
    });
  if (rows.length > 100) errors.push("每方最多 100 行，请拆分清单。");
  return { rows, errors };
}
export function toWriteContent(content) {
  const location = content.location?.region_id
    ? {
        region_id: Number(content.location.region_id),
        constellation_id: content.location.constellation_id
          ? Number(content.location.constellation_id)
          : null,
        solarsystem_id: content.location.solarsystem_id
          ? Number(content.location.solarsystem_id)
          : null,
      }
    : null;
  return {
    kind: content.kind,
    title: content.title || "",
    body: content.body || "",
    occurred_at: content.occurred_at || null,
    location,
    corporation_id: content.corporation_id
      ? Number(content.corporation_id)
      : null,
    images: (content.images || []).map(({ id, caption }) => ({
      id,
      caption: caption || "",
    })),
    battle:
      content.kind === "battle"
        ? {
            sides: (content.battle?.sides || newContent().battle.sides).map(
              (side) => ({
                name: side.name,
                isk_loss:
                  side.isk_loss == null || side.isk_loss === ""
                    ? null
                    : String(side.isk_loss),
                losses: (side.losses || []).map((row) => ({
                  ship_id: row.ship_id == null ? null : Number(row.ship_id),
                  ship_name:
                    row.ship_id == null && row.ship_name === "未知型号"
                      ? ""
                      : row.ship_name || "",
                  ship_class: row.ship_class || "",
                  quantity: Number(row.quantity),
                })),
              }),
            ),
          }
        : null,
  };
}
export function formatIsk(value) {
  if (value == null || value === "") return "ISK 未统计";
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return "ISK 格式待校验";
  const [integer, fraction] = text.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`} ISK`;
}
export function safeMediaUrl(value, apiBase) {
  const origin = new URL(
    apiBase,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  const url = new URL(value, origin);
  if (
    url.origin !== origin.origin ||
    url.search ||
    url.hash ||
    !/^\/api\/starsea\/media\/\d+\/$/.test(url.pathname)
  )
    throw new Error("图片地址不属于星海图片服务");
  return url.href;
}
export function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
