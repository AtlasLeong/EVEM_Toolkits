// Trusted build-time assets stay separate from the protected upload URL allowlist.
const ARTWORK = {
  fleet: new URL("../assets/corporations/covers/fleet.webp", import.meta.url).href,
  planet: new URL("../assets/corporations/covers/planet.webp", import.meta.url).href,
  shipyard: new URL("../assets/corporations/covers/shipyard.webp", import.meta.url).href,
  nebula: new URL("../assets/corporations/covers/nebula.webp", import.meta.url).href,
};
const THUMBNAILS = {
  fleet: new URL("../assets/corporations/covers/fleet-thumb.webp", import.meta.url).href,
  planet: new URL("../assets/corporations/covers/planet-thumb.webp", import.meta.url).href,
  shipyard: new URL("../assets/corporations/covers/shipyard-thumb.webp", import.meta.url).href,
  nebula: new URL("../assets/corporations/covers/nebula-thumb.webp", import.meta.url).href,
};

export function corporationCoverUrl(key, thumbnail = false) {
  const selected = typeof key === "string" && Object.hasOwn(ARTWORK, key) ? key : "fleet";
  return (thumbnail ? THUMBNAILS : ARTWORK)[selected];
}
