# Exact client item/image extraction toolchain

Maintained entrypoints for the site's shared GameData catalog. These tools read **named local client resource copies**, not account/session files. They never execute game scripts/native libraries, modify the emulator, poll the network, or invent image links. The original research artifacts remain under `output/client-ship-assets`; this package no longer imports their code.

## Reproducible environment

Use Python 3.10+ and a dedicated environment (the full extraction below was run with Python 3.11.9):

```powershell
python -m venv .venv-client-assets
.venv-client-assets/Scripts/python.exe -m pip install -r scripts/game_data/client_assets/requirements.txt
```

`requirements.txt` records the exact already-tested decoder/texture dependency versions. These are offline tooling dependencies, not additions to Django or frontend production requirements. Linux uses `.venv-client-assets/bin/python`; all CLI resource paths are explicit and platform-independent. New dependency versions must rerun these tests and a full snapshot verification before updating this reproducibility lock.

The external WPK stage-1 decoder must be the exact [`core/wpk/decryption.py` at pinned commit](https://github.com/liubairun/NeoXtractor-IDXWPK/blob/5b85425c7d5bb880d4a8775a82ef45dd6edac975/core/wpk/decryption.py), SHA-256:

```text
54e92c24ca00d0880ff027192974edb7026dac1d5e04207adebd48aaaadd063c
```

The local compatibility copy is `output/client-ship-assets/tool-probe-20260929/decryption.py`. On another machine, obtain only that fixed source from the upstream repository and pass its local path with `--decoder-file`; never import the upstream GUI, plugins, package initializers or network integrations. The loader hashes the bytes **before** execution, compiles those exact bytes (not an unpinned `.pyc`), and requires AES rather than accepting a silent fallback. No licence/notice was found at the pinned upstream revision, so we do **not** vendor that third-party code or imply permission to redistribute it. Source provenance, original code paths and reviewed hashes are in `provenance.json`.

## Explicit inputs

`--client-root` (alias `--source-root`) is the downloaded `res` snapshot layout, not a repository checkout. It contains:

```text
client-copy/
  inroot.thx                   current path -> content MD5 index (THFB)
  inroot.idx                   current content -> storage IDX (SKPW)
  inroot0.wpk, inroot1.wpk      current package containers
  inroot2.wpk ... inroot6.wpk   optional direct containers
  raw-packages/                compatibility copies of current package 2..6
  inroot/<content-md5>         standalone resources, where present
```

The original download directory is `/sdcard/Android/data/com.netease.EVE/files/neox/Documents/cloudfiles/res` in LDPlayer's `com.netease.EVE` installation. APK `assets/res` is an optional second resource root, supplied as `--apk-root <copied assets/res>`; the compatibility default is `<client-root>/runtime/apk_extract/assets/res`. Each root has its own `inroot.idx` and packages. Only exact digest/declared-size matching data is used; missing resources remain unresolved. Keep the client snapshot read-only and private, and do not put raw packages or the external decoder in a public web directory.

## Extraction and independent verification

From the repository root (both modules also accept absolute paths):

```powershell
python -m scripts.game_data.client_assets.build_item_image_library --client-root output/client-ship-assets --export-root output/client-ship-assets/maintained-export-20260930 --decoder-file output/client-ship-assets/tool-probe-20260929/decryption.py
python -m scripts.game_data.client_assets.verify_library --client-root output/client-ship-assets --export-root output/client-ship-assets/maintained-export-20260930 --decoder-file output/client-ship-assets/tool-probe-20260929/decryption.py --write-report
python -m unittest discover -s scripts/game_data/client_assets/tests -v
```

The exporter refuses a nonempty export directory. Use a **new directory for each client snapshot**, preserving older exports. Optional `--target-id <exact ID>` can be repeated for an arbitrary set of review ships; the verifier accepts zero, one or more targets and has no hardcoded seven-ship requirement. Optional `--manufacturing-scope <scope.json>` verifies a caller-selected recipe/item scope, with no dependency on another worktree or a Windows font. Verification is read-only unless `--write-report` is explicitly selected.

The standard route is:

```text
exact item ID -> staticdata/items/<ID modulo 101>.sd -> icon_id
             -> gui_v1/icon/item/<icon_id>.ktx -> THFB path-key lookup
             -> content MD5 -> IDX/WPK header/length -> pinned AC stage-1
             -> bounded ENON/DTSZ/Zstandard/zlib -> KTX ASTC -> RGBA PNG
```

The exported artifacts preserve `summary.json`, `tables.json`, `assets.json`, `item-image-mapping.json`, `icon-path-overrides.json`, `images/` and independent `verification.json`, which are accepted by `scripts/sync_game_data.py`. Source package paths, texture MD5/SHA-256, PNG SHA-256, exact table key/path and role/component warnings are retained. UTF-8 JSON is authoritative; a Windows terminal using a legacy code page may misrender Chinese without corrupting the file.

The independent verifier re-parses every table and compares exported fields/names with exact records, checks each route against the current THX, checks PNG hashes/dimensions, and—when `--decoder-file` is supplied—re-decodes each **unique** original texture and compares its pixels with the PNG. It validates all ID/image links separately and deduplicates expensive image conversion by unique content, not by item count.

## Snapshot-bound alternate routing

The maintained `routing/<THX SHA-256>.json` file holds exact item-ID-scoped static evidence for implant foreground/skill icons and configured big icons from the reviewed snapshot. The default selects it **only by an identical THX hash**. A future snapshot with no reviewed file uses standard routes only; it does not reuse old rules. `--routing-overrides <file>` permits an explicitly reviewed new evidence file, which must declare the identical current THX hash and retain exact ID/path/static evidence. A mismatched supplied file fails **before** any export write. `--no-overrides` disables every alternate route. Never widen a rule solely by `icon_id`, a similar name or visual resemblance. Preserve `imageRole` and `compositeWarning`: a foreground component is not a complete composited game icon.

Original source-code/disassembly paths inside the routing JSON are capture provenance only; they are not accessed at runtime. `provenance.json` records both original and maintained evidence hashes. New routes need fresh static evidence for the new snapshot, not an edit to an old hash-bound file.

## Classification and future ships

The reviewed client scripts in `evetypes` and `item_data` explicitly establish:

- `group_id = type_id // 1000000`
- `category_id = type_id // 1000000000`
- Exact table keys are split into modulo-101 shards; these fields are derived identifiers, not embedded columns in the item records.

The client category namespace is distinct from website market groups. Shared GameData uses client category **10** for hull classification, including ships absent from the market/import list. New exact IDs from a later client snapshot are imported normally; do not maintain a hand-picked seven-ship allowlist or derive hull membership from a market-only catalog.

Original evidence: `output/client-ship-assets/mapping-deep/native/item-icon-semantics.md`, `icon-inheritance-disassembly.txt`, and `loader-scripts/0-c484b50c1074d56a611ed71cb6122e43.dis.txt`; recorded hashes are in `provenance.json`. Generic icon access reads exact `item_data[type_id]['icon_id']`; no base-type inheritance was proven. In the reviewed snapshot, 12,105 items have no standard `icon_id`; 506 of those have separate `portrait_path` references requiring their own proven route. The generic client fallback `240000099` is a default UI icon, **not** an exact match; do not fill those records by rounding IDs or guessing pictures.

The 2026-09-30 snapshot verified 101 tables, 44,833 exact records, 32,675 mapped records and 2,702 unique PNG textures. These counts describe that local snapshot, including NPC/activity/variant/unpublished configuration; they are not the number of tradable items, every possible UI composition, or proof that the local client is the latest online patch. Future updates are an explicit acquire -> new export -> independent verify -> shared-catalog import workflow, not an automatic online patch watcher. Asset extraction does not establish a material redistribution licence.
