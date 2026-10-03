# KM Avatar Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align every participant avatar and make the hero ship 10% smaller.

**Architecture:** Remove the NPC-only layout decoration in the shared Killboard
stylesheet. Add a centered transform to the hero image selector only, preserving
layout and complete image containment.

**Tech Stack:** React, CSS, Node node:test, Vite, Playwright CLI.

---

### Task 1: Lock the requested styles

**Files:** Create `front-codex/tests/unit/killboardVisualPolish.test.mjs`.

1. Read the real stylesheet with `readFileSync`.
2. Assert no NPC-only left border or padding is declared.
3. Assert the hero image rule contains `transform:scale(.9)` and
   `transform-origin:center`, retains `object-fit:contain`, and that participant
   image selectors have no scaling transform.
4. Run `node --test tests/unit/killboardVisualPolish.test.mjs`; expect two failures
   because the NPC decoration exists and hero scale is absent.

### Task 2: Apply the minimum stylesheet change

**Files:** Modify `front-codex/src/styles/killboard.css`.

1. Delete `.kb-participant--npc { border-left:2px solid #76989d; padding-left:7px; }`.
2. Add `transform:scale(.9); transform-origin:center;` to the existing
   `.kb-hero .kb-asset--ship img` rule; change nothing else.
3. Run the new focused test and existing Killboard page/participant tests.
4. Run `npm run test:unit` and `npm run build`; expect all passing and bundle
   budget respected.

### Task 3: Browser and review

1. Start isolated Vite on loopback and mock stored-API requests using clearly
   labelled local-preview data. Use an actual bundled ship image for containment.
2. At 1600, 1024, and 700px widths, assert all avatar x coordinates align, all
   frames share borders/dimensions, and hero image bounding dimensions are 90%
   of its layout dimensions. Check center alignment and no new overflow.
3. Capture screenshots under `output/playwright/`, inspect them, and stop only
   the test browser/server created for this task.
4. Review the diff for unrelated changes and report that changes are local only.
