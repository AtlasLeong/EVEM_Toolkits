# Front Codex

## Client icon verification

The developer-only `/dev/icon-verification` page loads candidates from
`/dev/icon-candidates/manifest.json`. In this checkout, generate the local
candidate manifest and thumbnails with:

```sh
npm run icons:prepare
```

The no-argument command uses the extracted client data under
`../output/research/client-icons-2026-09-29/` and writes to the ignored
`front-codex/output/client-icon-candidates/` directory. For another extraction,
set `EVEM_ICON_MANIFEST`, `EVEM_ICON_IMAGES`, and `EVEM_ICON_OUTPUT`, or pass
`--manifest`, `--images`, and `--out` explicitly.

Generated candidates are local development artifacts and are intentionally not
committed. Start the Vite dev server after generation; its development-only
mount serves the manifest and hash-addressed thumbnails while refusing direct
Vite filesystem access. The Playwright workflow supplies a tiny in-memory
fixture, so the end-to-end test does not copy the full candidate set or add a
production route.

After reviewing bindings in the local page, validate and promote the original
PNG candidates into the production mapping with a dry run first:

```sh
node scripts/promote-client-icons.mjs \
  --mapping /path/to/confirmed-client-icon-mapping.json \
  --manifest "$EVEM_ICON_MANIFEST" \
  --images "$EVEM_ICON_IMAGES" \
  --sources /path/to/extracted-images
```

Add `--apply` only after reviewing the dry-run output. The promotion command
validates hashes and image metadata before atomically updating the mapping; it
does not delete old assets.
