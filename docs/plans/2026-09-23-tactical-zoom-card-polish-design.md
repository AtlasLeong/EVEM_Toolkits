# Tactical zoom and card polish — design

## Scope and intent

Improve the existing local tactical map without changing server APIs, tactical permissions, real system coordinates, or report history. The user chose stable callout direction over continuously re-solving the whole map. Do not publish, push, merge, or deploy this pass.

## Observed problems

- Every wheel event updates the camera and reruns viewport filtering, the 32-slot marker collision search, and name decluttering. The same card can switch sides of its star between adjacent zoom values; stars and gates themselves keep their real projected positions.
- Fleet archive and count-withdraw actions are drawn with different SVG geometries, hit areas, and centering rules. A count card without withdraw permission still reserves close-button text space.
- The two short destructive confirmations reuse a 680px form dialog. Their default paragraph margins, wide body, and generic dark primary button make them look disconnected from the tactical surface.

## Approved interaction

1. Camera zoom stays pointer-anchored but wheel input is frame-coalesced and less abrupt. Real star positions and gates remain unchanged. Native page scrolling remains cancelled while the pointer is on the map.
2. Each live force/count card gets a stable relative slot anchored to its star. Its text-sized badge stays readable at a constant screen size. Zoom/pan moves that star and its card together; layout may adjust only at viewport edges or when an overlay would obscure it. Scope/data/viewport changes may recompute slots. Priority names temporarily de-emphasize during a wheel gesture, then settle once, instead of independently flipping on every wheel event.
3. Fleet and count badges use one close-action geometry: a consistent 24px screen-space hit region, a centered 12px crossed-line icon, matching hover/focus states, and content-centered text in the space left of the action. Width remains content-adaptive, and a user without close permission receives no phantom reserved area. Keyboard labels and existing archive/withdraw permissions remain intact.
4. Both archive and withdraw confirmations use a compact confirmation variant (about 440px desktop, viewport-safe on mobile) within the existing dialog system. They identify the exact fleet or system/count, say the live map updates for collaborators, and state that history remains. A restrained danger treatment differentiates the final action from Cancel. There is no server mutation until explicit confirmation.

## Verification

- Unit tests reproduce cross-frame slot jumps and assert stable relative orientation, content centering, and no permission-dependent phantom space.
- Browser tests verify wheel zoom does not scroll the page or shuffle a nearby card, both × hit targets and visual centers match, Cancel never executes a command, and the two confirmations fit desktop and mobile with readable type.
- Run tactical unit tests, tactical E2E, and the frontend build/bundle check. Inspect desktop and narrow-screen renderings before declaring completion.

## Out of scope

No new map data, color-system replacement, new fleet semantics, removal of confirmation, or production deployment.
