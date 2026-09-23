// Kept separate from the API client so canvas and the local preview can share it.
export const ACTIVITY_OPTIONS = {
  sovereignty_production: "主权生产",
  pirate_combat: "海盗作战",
  pve: "异常与任务",
  industry: "工业制造",
  exploration: "星海探索",
  mining: "采矿生产",
  training: "新人培养",
};
export const ACTIVITY_LABELS = {
  ...ACTIVITY_OPTIONS,
  pvp: "舰队作战（旧标签）",
};
export const CUSTOM_TAG_LIMIT = 5;
export const CUSTOM_TAG_LENGTH = 12;

// Per-character casing avoids contextual final sigma. Expansion handles ß/ẞ;
// dotless i remains distinct. These are comparison keys, not display strings.
const comparisonKey = (value) =>
  [...value.normalize("NFKC").toLowerCase()]
    .map((char) => (char === "ı" ? char : char.toUpperCase().toLowerCase()))
    .join("");
const reserved = new Set(
  [...Object.values(ACTIVITY_LABELS), "舰队作战"].map(comparisonKey),
);
const invalidCharacters = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function tagValue(raw) {
  if (typeof raw !== "string" || invalidCharacters.test(raw))
    throw new Error("标签不能包含换行或不可见控制字符。");
  const value = raw.trim();
  if (!value || [...value].length > CUSTOM_TAG_LENGTH)
    throw new Error(`每个标签请输入 1–${CUSTOM_TAG_LENGTH} 字。`);
  if (reserved.has(comparisonKey(value)))
    throw new Error("该标签与内置选项重复，请直接选择上方活动方向。");
  return value;
}

export function validateCustomActivityTags(values) {
  if (!Array.isArray(values) || values.length > CUSTOM_TAG_LIMIT)
    throw new Error(`最多添加 ${CUSTOM_TAG_LIMIT} 个自定义标签。`);
  const result = [],
    seen = new Set();
  for (const raw of values) {
    const value = tagValue(raw),
      key = comparisonKey(value);
    if (seen.has(key)) throw new Error("这个标签已添加，请勿重复。");
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function normalizeCustomActivityTags(values) {
  if (!Array.isArray(values)) return [];
  let result = [];
  for (const raw of values) {
    try {
      result = validateCustomActivityTags([...result, raw]);
    } catch {
      /* Ignore malformed historical entries without rewriting the snapshot. */
    }
    if (result.length === CUSTOM_TAG_LIMIT) break;
  }
  return result;
}

export function activityLabels(values, custom = []) {
  const keys = Array.isArray(values)
    ? [
        ...new Set(
          values.filter(
            (key) =>
              typeof key === "string" && Object.hasOwn(ACTIVITY_LABELS, key),
          ),
        ),
      ]
    : [];
  return [
    ...keys.map((key) => ACTIVITY_LABELS[key]),
    ...normalizeCustomActivityTags(custom),
  ];
}

export function activityKind(content) {
  if (content?.activity_content_kind === "legacy_event") return "legacy_event";
  return content?.activity_content_kind === "overview" ||
    (content && Object.hasOwn(content, "activity_description"))
    ? "overview"
    : "legacy_event";
}

export const LEGACY_EVENT_FIELDS = {
  event_title: "旧版活动标题",
  event_time: "旧版活动时间",
  event_location: "旧版集结地点",
  event_description: "旧版活动说明",
};
