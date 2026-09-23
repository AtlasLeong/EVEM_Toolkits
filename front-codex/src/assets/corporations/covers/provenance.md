# Corporation default landscape covers

Generated for the approved four dedicated landscape covers on 2026-09-20.

## Generation and processing

- Tool: built-in `image_gen.imagegen` (default built-in mode), four independent generation calls.
- These are original generic science-fiction scenes. They are not official EVE artwork or claims about actual in-game ship models.
- Every image was composed natively as a 3:1 panorama. None is a crop from the eight portrait poster backgrounds.
- Post-processing: bundled Sharp, proportional resize and WebP encoding only; no creative editing, retouching, cropping, compositing, or generated placeholder art.
- Full cover: 1920 × 640, WebP quality 86. Thumbnail: 600 × 200, WebP quality 80.
- The nebula source is 2171 × 724; proportional scaling rounds to the same 1920 × 640 and 600 × 200 output dimensions.
- Four full covers: 703,852 bytes. Four thumbnails: 78,308 bytes. Total deliverable image payload: 782,160 bytes (~764 KiB).
- Originals and mechanical conversion script are preserved outside the source tree in `output/corporation-covers/`; generated originals at the tool paths were left intact.

## File inventory

| ID | Suggested display name | Source size | Full WebP bytes | Thumbnail bytes |
| --- | --- | --- | ---: | ---: |
| fleet | 冷蓝远征 | 2172 × 724 | 124,884 | 13,680 |
| planet | 行星晨曦 | 2172 × 724 | 145,780 | 17,360 |
| shipyard | 轨道船坞 | 2172 × 724 | 240,296 | 25,592 |
| nebula | 青金星云 | 2171 × 724 | 192,892 | 21,676 |

All deliverables in this directory: `<id>.webp` and `<id>-thumb.webp`.

## Visual QA

Each built-in result and each final full-resolution WebP was visually inspected:

- Fleet: clear horizontal flagship silhouette with cold blue escort formation; center band retains ship structure.
- Planet: warm sunrise and curving atmospheric horizon remain legible across both panorama and central crop.
- Shipyard: distinct industrial dock framing, horizontal ship, and restrained amber lighting.
- Nebula: teal/gold dust structure and central luminous ridge, visually distinct from the other covers.
- No visible text, brand marks, watermarks, UI, grids, borders, or collages.
- No generation failures or creative edit retries were required.

## Exact prompts and original source paths

### fleet — 冷蓝远征

Built-in original: `C:/Users/22351/.codex/generated_images/01a0bed8-3c5f-7080-b152-420379b345c1/exec-832c8ae4-0dac-4508-b997-3a5b2eac4770.png`

Workspace original copy: `D:/Code/EVEM_Toolkits/.worktrees/community-corp/output/corporation-covers/fleet-original.png`

```text
Use case: stylized-concept
Asset type: production website corporation cover background, a single full-bleed native 3:1 panoramic image, ideally 1920 x 640 pixels.
Primary request: an original deep-space expedition fleet seen from the side, several long angular warships extending horizontally across the vista. Hero capital ship close enough to recognize a clear silhouette, smaller distant escorts creating scale, no active combat.
Scene/backdrop: vast sparse star field and restrained wisps of cold interstellar dust.
Style/medium: premium photorealistic hard-science-fiction cinema environment, believable brushed metal hulls, restrained mechanical detailing, physically coherent shadows, sophisticated quiet composition.
Composition/framing: extremely wide panoramic 3:1 canvas, ships mostly parallel to the horizon. Main recognizable ship silhouette centered horizontally and vertically within the middle horizontal band, keep essential ship shape readable in a centered narrower mobile crop. Do not put essential subjects at extreme edges. Image covers the complete canvas, no blank borders or letterbox bars.
Lighting/mood: icy blue rim lighting and pale cyan engine glints against charcoal space, confident exploration mood, clear silhouettes rather than an overly black image.
Constraints: this is one new dedicated landscape painting, not a collage or vertical poster crop. Entire image must contain absolutely no text, letters, numerals, logos, watermarks, symbols, UI, frames, or typography. Original generic spacecraft only, not recognizable game franchise ships. No explosions, no busy laser beams, no giant lens flares.
```

### planet — 行星晨曦

Built-in original: `C:/Users/22351/.codex/generated_images/01a0bed8-3c5f-7080-b152-420379b345c1/exec-a2ee1c32-94cb-4c54-801e-d5895b7eaae8.png`

Workspace original copy: `D:/Code/EVEM_Toolkits/.worktrees/community-corp/output/corporation-covers/planet-original.png`

```text
Use case: stylized-concept
Asset type: production website corporation cover background, a single full-bleed native 3:1 panoramic image, ideally 1920 x 640 pixels.
Primary request: the awe-inspiring warm golden horizon of a huge terrestrial planet seen from low orbit, the planet's gentle curvature stretching across the whole width, intricate bronze mountain ranges and cloud layers, a thin amber atmospheric halo at dawn.
Scene/backdrop: silent deep black-blue space with a few tiny stars and one small distant moon.
Style/medium: premium photorealistic hard-science-fiction cinema environment, realistic orbital landscape and fine natural planetary textures, elegant restrained composition, believable physical scale.
Composition/framing: extremely wide panoramic 3:1 canvas. The luminous curving horizon crosses the central horizontal band, the subtle sunrise glow sits near the center so a centered mobile crop remains meaningful. Lower half contains rich but quiet planet surface; upper half dark open space. Full-bleed, no blank borders or letterbox bars.
Lighting/mood: warm gold and pale champagne light catching an amber atmosphere against near-black navy space, serene grandeur, visibly different from blue fleet artwork, no aggressively orange saturation.
Constraints: this is one newly composed dedicated landscape painting, not a collage or a crop from a portrait image. Absolutely no text, letters, numerals, logos, watermarks, symbols, UI, frames, or typography. No spacecraft, no buildings, no fictional planetary labels, no giant lens flare.
```

### shipyard — 轨道船坞

Built-in original: `C:/Users/22351/.codex/generated_images/01a0bed8-3c5f-7080-b152-420379b345c1/exec-0c220722-bdf3-4502-bfc3-36db76be6655.png`

Workspace original copy: `D:/Code/EVEM_Toolkits/.worktrees/community-corp/output/corporation-covers/shipyard-original.png`

```text
Use case: stylized-concept
Asset type: production website corporation cover background, one full-bleed native 3:1 panoramic image, ideally 1920 x 640 pixels.
Primary request: a monumental orbital shipyard, seen across its entire wide open industrial dry dock. A long original spacecraft rests horizontally in the middle, framed by steel gantries, trusses, service arms, and precise amber docking lights.
Scene/backdrop: dark orbital space visible through a vast open hangar aperture, distant tiny stars, powerful sense of deep industrial scale.
Style/medium: premium photorealistic hard-science-fiction cinema environment, industrial realism, believable metallic structures, restrained wear, polished production concept art without a painterly look.
Composition/framing: extremely wide panoramic 3:1 frame. Strong horizontal architecture and a single centered recognizable ship outline across the middle band. Main dock cavity and ship remain readable in a center mobile crop and short website masthead. Architectural ceiling and lower platforms may crop without losing the focus. Full-bleed with no borders or letterbox bars.
Lighting/mood: dark graphite metal, small rhythmic amber dock lamps, soft neutral fill lighting that reveals the structure, confident industrious mood. Distinct from a blue space fleet or golden planet landscape; avoid overbright flare.
Constraints: a newly composed dedicated landscape painting, not a portrait crop or collage. No people. Absolutely no text, letters, numbers, logos, watermarks, signage, UI, symbols, or typography anywhere. Entirely original spacecraft and architecture, no recognizable game franchise ship. No battles, lasers, explosions, orange fog, or excessive detail noise.
```

### nebula — 青金星云

Built-in original: `C:/Users/22351/.codex/generated_images/01a0bed8-3c5f-7080-b152-420379b345c1/exec-829c1842-64e6-47ce-8ba8-fb50881b2db9.png`

Workspace original copy: `D:/Code/EVEM_Toolkits/.worktrees/community-corp/output/corporation-covers/nebula-original.png`

```text
Use case: stylized-concept
Asset type: production website corporation cover background, one full-bleed native 3:1 panoramic image, ideally 1920 x 640 pixels.
Primary request: a majestic horizontal interstellar nebula, sculptural teal and blue-green dust clouds threading through delicate muted gold filaments, a luminous central star nursery surrounded by deep black star-filled space.
Scene/backdrop: vast astronomical deep space, subtle layered dust, finely scattered distant stars, physically plausible nebula structure.
Style/medium: premium cinematic astronomical realism, refined high-resolution space photography aesthetic with detailed translucent gas rather than painted swirls, tasteful restrained saturation.
Composition/framing: extremely wide panoramic 3:1 canvas, distinctive flowing cloud structures concentrated across the middle horizontal band, graceful darkness above and below. Main central teal-gold dust ridge remains identifiable in a center mobile crop and very short website masthead. Full-bleed image, no blank borders, no letterbox bars.
Lighting/mood: soft internal cyan/teal glows with sparse warm gold pinpoints and midnight shadows, calm mysterious grandeur, visible dimensional detail instead of flat gradients.
Constraints: one new dedicated landscape artwork, not a collage, not a portrait crop. Absolutely no text, letters, numerals, logos, watermarks, diagrams, constellations drawn with lines, symbols, UI, frames, or typography. No spacecraft, planets, buildings, human faces, eyes, fantasy creatures, giant lens flare, oversaturated rainbow, or symmetrical tunnel.
```
