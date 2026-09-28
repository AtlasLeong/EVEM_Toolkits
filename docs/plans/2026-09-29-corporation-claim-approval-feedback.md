# Corporation Claim Approval Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make it explicit that approving a corporation ownership claim grants management access but does not publish an empty public profile, with a direct link to the owner workspace.

**Architecture:** Keep the existing claim/revision approval rules and database contract unchanged. Extend the review page's completion notice with the approved corporation id and route the moderator to `/corporations/manage?id=<id>`; revision approvals retain the existing published confirmation.

**Tech Stack:** React, React Router, TanStack Query, Playwright/browser regression tests.

---

### Task 1: Add a failing review-flow regression test

**Files:**
- Modify: `front-codex/tests/e2e/specs/corporation-stability.spec.js`

**Step 1:** Add a test assertion that approving a claim renders a management-workspace link and explains that public publication requires a separate profile review.

**Step 2:** Run the focused test and confirm it fails because the current notice is only plain text.

### Task 2: Implement the approval completion notice

**Files:**
- Modify: `front-codex/src/pages/CorporationReview.jsx`

**Step 1:** Preserve the approved corporation id when the decision callback completes.

**Step 2:** Render a role-status notice with explicit claim/revision wording and a management link for approved claims.

**Step 3:** Keep the existing cache refresh and review-list behavior unchanged.

### Task 3: Verify and document

**Files:**
- Modify: `docs/plans/2026-09-29-corporation-claim-approval-feedback.md`

**Step 1:** Run the focused browser test and frontend unit/preview tests.

**Step 2:** Run the production frontend build and inspect the diff.

**Step 3:** Commit the implementation with a focused message.

## Verification evidence

- Focused approval-flow browser test: 1 passed.
- Corporation stability browser suite: 12 passed.
- Frontend unit and preview tests: passed with no failures.
- Production frontend build and bundle budget: passed.
