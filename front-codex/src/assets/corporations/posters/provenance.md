# Corporation poster artwork provenance

Generated on 2026-09-20 using the built-in `image_gen.imagegen` tool. One independent generation call was made for each final asset; these are not crops from the earlier eight-panel direction board. The user approved all eight directions. No external stock art or exact named game-ship reference was supplied.

## Production files

All production backgrounds are WebP 1080 × 1440 pixels, with separate 240 × 320 pixel thumbnails. Generated originals were 1086 × 1448 pixels. Only mechanical proportional resizing and WebP encoding were applied using Sharp (quality 88 for full images, 77 for thumbnails, effort 6); there was no compositing, retouching, geometric artwork substitution, or content editing after generation. The original PNGs are preserved in `output/corporation-art/<id>.png` within the worktree and at the built-in tool's original saved location.

| ID | Name | Full bytes | Thumbnail bytes | Original PNG bytes |
| --- | --- | ---: | ---: | ---: |
| expedition-fleet | 远征舰队 | 132932 | 5396 | 2090470 |
| ringed-planet | 星环巨行星 | 174526 | 6860 | 2169624 |
| spiral-galaxy | 旋臂星河 | 274972 | 9938 | 2571825 |
| orbital-shipyard | 轨道船坞 | 315492 | 14964 | 2567977 |
| black-hole | 黑洞视界 | 183832 | 8112 | 1972277 |
| stellar-nursery | 创生星云 | 236592 | 11712 | 2399524 |
| frozen-frontier | 冰封边境 | 280402 | 11188 | 2517653 |
| wreckfield | 战舰残骸 | 215376 | 7420 | 2384857 |

The application imports `<id>.webp` and `<id>-thumb.webp` from this directory. Full artworks total 1814124 bytes; all thumbnails total 75590 bytes.

## Visual inspection

All eight generated originals were visually inspected through native tool output: subjects and palettes are distinct, every output is a single portrait scene, and none contains visible text, numbering, UI, borders, or watermarks. Generated ships are original hard-science-fiction concepts, not asserted to be exact EVE hulls. The shipyard and stellar nursery intentionally retain scene detail near text regions; the renderer should apply localized contrast overlays, while leaving the central artwork readable. The frozen frontier has a bright moon surface and requires particular care with lower-body text contrast.

## Exact generation prompts

### expedition-fleet — 远征舰队

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-5df13f47-b627-4496-8e31-40e9af7c3686.png`

Workspace original: `output/corporation-art/expedition-fleet.png`

Production: `front-codex/src/assets/corporations/posters/expedition-fleet.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/expedition-fleet-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: Expedition fleet, an immense original angular graphite battleship crossing diagonally through cold navy deep space, several distant escorts and crisp cyan engine lights; monumental scale and credible engineering.
Style/medium: cinematic photoreal hard science-fiction VFX, premium highly detailed space cinematography, physically plausible brushed metal and battle-weathered armor, not an illustration diagram.
Composition/framing: ONE image, full-bleed portrait 3:4 at high resolution ideally 1536x2048. The impressive battleship and escorts occupy the middle 30%-68% of the frame; keep top quarter and lower quarter naturally dark and visually calmer for later app-rendered text, with sparse stars and subtle atmospheric depth rather than flat black panels. Ship silhouette must be readable at thumbnail size.
Lighting/mood: cold blue rim lighting, cyan engines, restrained luminous highlights, majestic and purposeful.
Constraints: ORIGINAL spacecraft design; no exact franchise hull. No text, words, letters, numbers, logos, watermark, UI, HUD, grids, border, mockup, poster lettering, or contact sheet. Do not make several panels. Pure scene artwork.
```

### ringed-planet — 星环巨行星

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-8a791dc2-bf9c-4d0c-a848-968fb6bb1dae.png`

Workspace original: `output/corporation-art/ringed-planet.png`

Production: `front-codex/src/assets/corporations/posters/ringed-planet.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/ringed-planet-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: Ringed giant planet, a vast ochre and ivory gas giant with intricately layered cloud bands and sweeping physically plausible dust rings, viewed from space in warm distant sunlight; breathtaking celestial scale.
Style/medium: cinematic photoreal astronomy-inspired hard-science-fiction VFX; natural volumetric cloud bands and fine granular ring texture, premium detailed space imagery.
Composition/framing: ONE full-bleed portrait 3:4 image at high resolution ideally 1536x2048. Planet and ring plane dominate the middle 30%-68% of frame, sweeping diagonally across the middle with confident negative space. Top quarter and lower quarter are naturally dark calmer space for later app-rendered text; sparse tiny stars and subtle warm dust only, not flat black panels. Clearly recognizable gas giant even at thumbnail scale.
Lighting/mood: warm gold rim sunlight, deep umber shadows, ivory cloud tops, amber ring glint; serene but monumental.
Constraints: No spacecraft needed. No text, letters, numbers, logos, watermark, UI, HUD, grids, border, mockup, contact sheet, or multiple panels. Pure scene artwork.
```

### spiral-galaxy — 旋臂星河

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-b0f91af5-594c-4623-bed6-c48e54a155a4.png`

Workspace original: `output/corporation-art/spiral-galaxy.png`

Production: `front-codex/src/assets/corporations/posters/spiral-galaxy.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/spiral-galaxy-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: A grand spiral galaxy with a luminous warm-white core, blue-violet spiral arms, intricate interstellar dark dust lanes and countless star clusters, floating in otherwise deep indigo space.
Style/medium: premium photoreal cinematic astronomy-inspired hard-science-fiction VFX; realistic long-exposure celestial detail, not a painted swirl.
Composition/framing: ONE full-bleed portrait 3:4 at high resolution ideally 1536x2048. Tilted oblique galaxy centered in middle 30%-68% of frame, broad elegant arms visibly curling around a luminous core. Top quarter and lower quarter naturally dark and quieter, fine sparse stars, reserved for text rendered by the application later. Galaxy must stay immediately recognizable at thumbnail scale.
Lighting/mood: luminous core, indigo and soft violet arm highlights, deep dark-blue space; wonder and exploration, controlled highlights.
Constraints: No text, words, letters, numbers, logos, watermark, UI, HUD, grid lines, borders, mockup, contact sheet, or multiple panels. Pure scene artwork.
```

### orbital-shipyard — 轨道船坞

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-8a0729c4-b9cf-4be9-a456-cd702b26550e.png`

Workspace original: `output/corporation-art/orbital-shipyard.png`

Production: `front-codex/src/assets/corporations/posters/orbital-shipyard.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/orbital-shipyard-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: A colossal asymmetric orbital shipyard assembling an original capital spacecraft, vast skeletal industrial gantries, layered docking ribs and cranes with tiny amber practical lights, a distant planet limb providing scale.
Style/medium: cinematic photoreal hard-science-fiction VFX, premium production concept render, physically credible weathered steel, brushed titanium, modular construction, intricate but coherent engineering.
Composition/framing: ONE full-bleed portrait 3:4 at high resolution ideally 1536x2048. Industrial dock and docked original ship dominate middle 30%-68% of frame; wide dramatic low-angle space perspective. Top quarter and bottom quarter naturally shadowy calmer space and industrial silhouette for later app-rendered text. Strong asymmetric silhouette, not a circular sci-fi ring.
Lighting/mood: amber work lamps against graphite-black and cool blue orbital space, tiny scale cues, imposing industrial realism.
Constraints: Original ship, not an exact franchise model. No people. No text, words, letters, numbers, logos, watermark, UI, HUD, grids, border, mockup, contact sheet, or multiple panels. Pure scene artwork.
```

### black-hole — 黑洞视界

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-a3b778e4-4b58-47b4-91bc-164163e51cab.png`

Workspace original: `output/corporation-art/black-hole.png`

Production: `front-codex/src/assets/corporations/posters/black-hole.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/black-hole-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: A terrifyingly beautiful supermassive black hole seen from an oblique angle, absolute-black central disk surrounded by a thin brilliantly glowing copper and white accretion disk whose light bends above and below the event horizon due to gravitational lensing. Fine hot plasma filaments, deep black starfield, physically inspired cinematic scale.
Style/medium: premium cinematic photoreal hard-science-fiction VFX, nuanced light and astrophysical realism, not a fantasy portal.
Composition/framing: ONE full-bleed portrait 3:4 image at high resolution ideally 1536x2048. Central black-hole event horizon and lensed ring occupy middle 30%-68% of frame with broad surrounding negative space. Top quarter and lower quarter naturally almost black with very fine sparse stars and faint dust for later app-rendered text. Simple powerful celestial silhouette.
Lighting/mood: copper-white hot ring, amber glint, absolute blacks, restrained filmic bloom, awe and mystery.
Constraints: No spacecraft, no lasers, no text, words, letters, numbers, logos, watermark, UI, HUD, grids, border, mockup, contact sheet, or multiple panels. Pure scene artwork.
```

### stellar-nursery — 创生星云

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-1901de64-f054-4386-94af-1923ad7208f1.png`

Workspace original: `output/corporation-art/stellar-nursery.png`

Production: `front-codex/src/assets/corporations/posters/stellar-nursery.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/stellar-nursery-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: A stellar nursery of vast sculptural interstellar dust pillars, towering dark teal molecular clouds edged in luminous gold, fine starlight emerging in crevices, intricate wisps of dust illuminated by newborn stars. Rich three-dimensional cosmic cloud forms, astrophotography-inspired detail.
Style/medium: premium cinematic photoreal deep-space VFX, natural astronomical textures, not abstract paint or smoke in a studio.
Composition/framing: ONE full-bleed portrait 3:4 at high resolution ideally 1536x2048. Distinct sculptural pillars and luminous crevices fill the middle 30%-68% with sweeping depth; top quarter and lower quarter naturally quieter deep teal-black clouds and fine sparse stars for later app-rendered text. Unmistakably nebular, not a planet or spiral galaxy.
Lighting/mood: muted emerald-teal shadows, warm gold stellar edges, tiny diamond-white starlight, grandeur and quiet creation.
Constraints: No text, words, letters, numbers, logos, watermark, UI, HUD, grid, border, mockup, contact sheet, or multiple panels. No humans, no spacecraft. Pure scene artwork.
```

### frozen-frontier — 冰封边境

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-64de47ca-bc71-4dca-95b8-d13ef10f6e0c.png`

Workspace original: `output/corporation-art/frozen-frontier.png`

Production: `front-codex/src/assets/corporations/posters/frozen-frontier.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/frozen-frontier-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: Frozen frontier from low orbit above a vast icy moon, the moon's curved horizon and blue-white cracked ice plains crossed by immense dark fractures, sculpted frost, a distant pale crescent planet suspended in star-filled black space.
Style/medium: cinematic photoreal hard-science-fiction VFX and orbital landscape photography, premium natural surface textures, convincing planetary scale and atmospheric light falloff.
Composition/framing: ONE full-bleed portrait 3:4 at high resolution ideally 1536x2048. The frozen moon's illuminated curve and dramatic fracture network dominate middle 30%-68% of frame with the distant crescent small near the horizon. Top quarter dark quiet space; bottom quarter recedes into the moon's night-side shadows, calm enough for later app-rendered text without flat black rectangles. Strong recognizable icy-world silhouette.
Lighting/mood: glacial cyan, silver frost, deep navy shadow, distant cold sunlight, isolated exploration.
Constraints: No text, words, letters, numbers, logos, watermark, UI, HUD, grid, border, mockup, contact sheet, or multiple panels. No people or buildings. Pure scene artwork.
```

### wreckfield — 战舰残骸

Tool: built-in `image_gen.imagegen`

Original saved path: `C:/Users/22351/.codex/generated_images/01a0beb9-99b0-7d53-8e95-0ec4d6f89b24/exec-6b471091-adf6-4db0-9836-d80acf19ae21.png`

Workspace original: `output/corporation-art/wreckfield.png`

Production: `front-codex/src/assets/corporations/posters/wreckfield.webp`

Thumbnail: `front-codex/src/assets/corporations/posters/wreckfield-thumb.webp`

```text
Use case: stylized-concept.
Asset type: final portrait sci-fi corporation recruitment poster background.
Primary request: A wreckfield in deep space, one immense original derelict battleship fractured into torn armored hull plates and exposed structural ribs, large disconnected stern and bow fragments with restrained scattered smaller debris, distant dim red star glowing through dust.
Style/medium: cinematic photoreal hard-science-fiction VFX, premium intricate weathered metal, scorched composite armor and credible damaged engineering, not a battlefield explosion illustration.
Composition/framing: ONE full-bleed portrait 3:4 image at high resolution ideally 1536x2048. Broken warship silhouette occupies middle 30%-68% of frame on a dramatic diagonal, clear readable negative-space gaps through skeletal hull ribs; sparse fragments give massive scale. Top quarter and lower quarter naturally dark calmer space with faint copper dust for later app-rendered text.
Lighting/mood: copper-black space, subdued red stellar backlight, warm edge glints across cold dark metal; haunting grandeur, quiet aftermath.
Constraints: Original ship design, no exact franchise hull. No gore, no people, no active explosions. No text, words, letters, numbers, logos, watermark, UI, HUD, grid, border, mockup, contact sheet, or multiple panels. Pure scene artwork.
```
