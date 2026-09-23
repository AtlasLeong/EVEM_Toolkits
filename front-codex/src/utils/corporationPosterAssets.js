import { normalizePosterBackground } from './corporationPoster';

// Bundled artwork is deliberately separate from the protected upload URL allowlist.
const ARTWORK = {
  'expedition-fleet': new URL('../assets/corporations/posters/expedition-fleet.webp', import.meta.url).href,
  'ringed-planet': new URL('../assets/corporations/posters/ringed-planet.webp', import.meta.url).href,
  'spiral-galaxy': new URL('../assets/corporations/posters/spiral-galaxy.webp', import.meta.url).href,
  'orbital-shipyard': new URL('../assets/corporations/posters/orbital-shipyard.webp', import.meta.url).href,
  'black-hole': new URL('../assets/corporations/posters/black-hole.webp', import.meta.url).href,
  'stellar-nursery': new URL('../assets/corporations/posters/stellar-nursery.webp', import.meta.url).href,
  'frozen-frontier': new URL('../assets/corporations/posters/frozen-frontier.webp', import.meta.url).href,
  wreckfield: new URL('../assets/corporations/posters/wreckfield.webp', import.meta.url).href,
};
const THUMBNAILS = {
  'expedition-fleet': new URL('../assets/corporations/posters/expedition-fleet-thumb.webp', import.meta.url).href,
  'ringed-planet': new URL('../assets/corporations/posters/ringed-planet-thumb.webp', import.meta.url).href,
  'spiral-galaxy': new URL('../assets/corporations/posters/spiral-galaxy-thumb.webp', import.meta.url).href,
  'orbital-shipyard': new URL('../assets/corporations/posters/orbital-shipyard-thumb.webp', import.meta.url).href,
  'black-hole': new URL('../assets/corporations/posters/black-hole-thumb.webp', import.meta.url).href,
  'stellar-nursery': new URL('../assets/corporations/posters/stellar-nursery-thumb.webp', import.meta.url).href,
  'frozen-frontier': new URL('../assets/corporations/posters/frozen-frontier-thumb.webp', import.meta.url).href,
  wreckfield: new URL('../assets/corporations/posters/wreckfield-thumb.webp', import.meta.url).href,
};

export const posterArtworkUrl = key => ARTWORK[normalizePosterBackground(key)];
export const posterThumbnailUrl = key => THUMBNAILS[normalizePosterBackground(key)];
