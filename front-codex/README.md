# Front Codex

## Client icon verification

The developer-only `/dev/icon-verification` page loads candidates from
`/dev/icon-candidates/manifest.json`. Generate the local candidate manifest
and thumbnails with:

```sh
npm run icons:prepare
```

Generated candidates are local development artifacts and are intentionally not
committed. The Playwright workflow supplies a tiny in-memory fixture, so the
end-to-end test does not copy the full candidate set or add a production route.
