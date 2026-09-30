# Shared client item icons

Original client PNGs exported by the shared GameData library, not screenshot crops or generated illustrations. Filenames are the SHA-256 of each PNG's bytes; different item IDs may intentionally share one image.

Only verified standard item icons referenced by the current manufacturing scope and approved market icon list are included. The scoped browser lookup is maintained in `src/data/game-item-images.json`; the immutable source catalog revision and catalog SHA-256 are recorded there. Source package and local filesystem details are not published in the browser lookup.

Keep original proportions when displaying these PNGs (`object-fit: contain`). Update using `scripts/import-game-item-images.mjs`; validate without `--apply` before installing a new snapshot.
