# Filter blank-area Chrome crash investigation

## Evidence

- User reports Chrome STATUS_BREAKPOINT after selecting a location and clicking blank space beside its selected chip.
- Reproduced on local Chrome 151.0.7922.174 against commit 652a30c. Playwright reports `locator.click: Target crashed` for the selected-list blank surface.
- Captured event sequence: pointerdown on `.picker-selected`, then focusout from `.picker-option.active` with no relatedTarget. The details onBlur handler synchronously closed the panel for this null target.
- Regression tests reproduced renderer crashes for both location and resource selectors. A separate blur test showed that an absent next focus target incorrectly closed the panel.

## Minimal fix

Only close from onBlur when a concrete next focus target is outside the details. Null targets (internal blank clicks or document focus loss) are not evidence of leaving the panel. The existing outside-pointer handler and Escape/keyboard-leave behavior remain in place. No selection, layout, API or calculation changes.

## Verification

Add `front-codex/tests/e2e/specs/filter-disclosure-focus.spec.js` covering repeated blank clicks, continued input usability, preserved selection, outside clicks, document focus loss, Shift+Tab and Escape. Re-run the formerly crashing operation on installed Chrome as well as the full bundled Chromium suite and build. Do not claim resolution from tests alone without repeating the actual crash path.
