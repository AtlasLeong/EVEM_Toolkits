export const CORPORATION_COVER_KEYS = ["fleet", "planet", "shipyard", "nebula"];

export function defaultCorporationCoverKey(corporation) {
  const id = corporation?.id;
  const identity =
    (typeof id === "string" ? id.trim() : Number.isFinite(id) ? String(id) : "") ||
    (typeof corporation?.name === "string" ? corporation.name.trim() : "");
  if (!identity) return CORPORATION_COVER_KEYS[0];

  // FNV-1a keeps a corporation's appearance stable without storing a new field.
  let hash = 2166136261;
  for (const character of identity) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return CORPORATION_COVER_KEYS[(hash >>> 0) % CORPORATION_COVER_KEYS.length];
}
