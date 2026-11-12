---
name: handoff
description: End a working session on Project 80x40. Updates PROJECT_STATE.md so the next session, on any Claude account or machine, starts fully briefed.
---

1. Rewrite `docs/context/PROJECT_STATE.md`: current phase and next gate, what changed, what is in progress,
   the next five steps, and blockers. Keep it under one screen.
2. If a decision was made, write a new `docs/adr/NNNN-*.md` and add one line to `docs/context/DECISIONS.md`.
3. If the plan turned out wrong, add it to `docs/plan/v1.2-notes.md`.
4. Run `npm --prefix packages/db test` and report the result.
5. Commit, and push only if a remote is configured.
