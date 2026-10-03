# KM avatar alignment and hero artwork scale

## Scope

The supplied screenshots show an extra left boundary only on NPC participant
rows and oversized artwork in the report hero. Follow the user's standing
instruction to decide implementation details without another design question.

## Design

- Remove the NPC-only `border-left` and `padding-left`. Keep the NPC class and
  identity data, the shared avatar border, final-blow cues, and damage labels.
- Scale only the hero ship image to 90%, centered in its existing container.
  Preserve `object-fit: contain`, container dimensions, layout tracks, and all
  responsive breakpoints. Participant and equipment art remain unchanged.
- Prefer image scaling to changing grid widths or container height: it shrinks
  both landscape and portrait artwork equally without reflowing report metadata.
  Adding a boundary to every row would add visual noise, so remove the special
  boundary rather than duplicating it.

## Verification

Add CSS contract regressions and observe failures before implementation. Run
focused and full frontend unit tests plus the production build. In a local
browser with explicit synthetic data, compare NPC/non-NPC left coordinates,
avatar borders and dimensions, hero image scale and containment across desktop,
narrow desktop, and mobile widths. Review the final scoped diff.

No API, collector, database, merge, push, or production deployment changes are
part of this request.
