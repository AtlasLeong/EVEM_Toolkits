# White sidebar avatar

2026-09-08. Local-only update on `codex/ui-dark-console`; no push or deployment.

- Asset: `../../front-codex/public/guristas-avatar-white.png` (256 × 256 RGBA).
- Preview: `white-avatar-preview.png`.
- Original images are preserved. Only the shared sidebar image and its background/padding changed; navigation and business logic are unchanged.
- Generated with the built-in imagegen tool, then locally extracted with Pillow after explicit user approval because both generated outputs had baked-in checkerboards. This is not an API/CLI generation fallback.
- Input reference: `front-codex/public/Guristas_Logo_new.png`.
- Selected generated source: `C:/Users/22351/.codex/generated_images/019fb19c-7323-7c83-a6ac-dabea48d36c3/exec-d847f994-ac66-4c49-844b-e8dd11a0c796.png`.
- Reproducible extraction: `prepare-white-avatar.py SOURCE.png OUTPUT.png`. Background luminance is removed, artwork becomes pure white, and the alpha mask is downsampled with antialiasing.

## Generation prompt

Use case: logo-brand. Input image: existing Guristas rabbit-skull icon, subject reference. Generate a refined WHITE avatar version of this same rabbit-skull head emblem for the top-left of a dark sci-fi dashboard. Preserve recognizable skull face and two swept long rabbit ears; simplify ragged detail into clean confident shapes, clear eyes and teeth as transparent negative-space cutouts. Single flat pure-white silhouette, centered square composition, head fills 90% of height, balanced compact width, legible at 36 pixels. Genuinely transparent alpha background, including eye sockets, mouth gaps and space between ears. No white background, no black background, no colored pixels, no border, no badge, no enclosing circle, no text, no glow, no shadow, no gradients, no 3D. Output transparent PNG suitable as a UI asset.

## Verification

- New regression test failed before implementation on the old image reference.
- `npm run test:e2e -- tests/e2e/specs/shell-nav.spec.js`: 2 passed. Verifies image decoding, zero-alpha background, opaque white artwork, no CSS background frame, and existing logo navigation.
- `npm run build`: passed.
- Browser screenshot inspected: white emblem on dark sidebar, without a checkerboard or white backing.
- Full regression suite was not rerun for this asset-only change.
