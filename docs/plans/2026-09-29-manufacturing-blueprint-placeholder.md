# Hide unavailable blueprint control

**Approved design:** The user chose to hide the unimplemented blueprint ownership option, not add manual blueprint pricing. Remove its UI state and the always-zero conditional. Keep a clear `蓝图费用 / 未计入` disclosure in the cost breakdown; do not change the costing engine or imply that blueprints are free.

## Implementation plan

1. Add a manufacturing E2E asserting no blueprint checkbox and a `未计入` cost label (not `0 ISK`). Run it red.
2. In `front-codex/src/pages/ManufacturingEstimator.jsx`, remove `blueprintOwned`, pass the remaining settings unchanged, remove the checkbox and change the summary disclosure.
3. Run all manufacturing E2E, all frontend unit tests, production build and `git diff --check`.
4. Separately investigate client item icons using local resource copies; do not change client files or substitute unverified artwork. Record actual extracted assets and mapping evidence before frontend integration.

No push or deployment is included in this request.
