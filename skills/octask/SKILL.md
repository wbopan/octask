---
name: octask
description: Phase-gate task management conventions for TASKS.md files. Use this skill whenever you are about to create, edit, update, or modify tasks in a TASKS.md file — including marking task status, adding new tasks, writing acceptance criteria, or restructuring phases. Also trigger when the user mentions TASKS.md, asks to add a todo, track progress, plan project phases, or manage task status. Even if you're just marking a single task as done, consult this skill first.
---

# Task Management

Conventions and workflow for maintaining a `TASKS.md` file that follows a phase-gate model. This skill tells you how to read, write, and update tasks correctly.

## Why Phase-Gate

A research or engineering project naturally breaks into phases. Each phase produces a verified foundation that the next phase builds on. Within a phase, tasks share that foundation and can be worked on in parallel. Between phases, a "goal" describes what "done enough" looks like — not a hard checklist, but a soft gate that helps decide when to shift focus.

This structure matters because it controls blast radius: if a Phase 1 conclusion turns out wrong, only Phase 1 work is affected. If phases are entangled, a single bad result can invalidate work across the board.

## File Structure

`# TASKS` → `## Phase N: Name` → `Goal:` paragraph → task list. Each task is a `- [ ]` line ending with a `#slug` ID, with indented description and `AC:` line underneath.

When creating a new TASKS.md from scratch, copy `references/template.md` and fill in the placeholders.

## Status Symbols

| Symbol | Meaning | When to use |
|--------|---------|-------------|
| `[ ]`  | Todo | Task hasn't been started |
| `[/]`  | Ongoing | Work has begun but isn't complete |
| `[x]`  | Done | Acceptance criteria met |
| `[-]`  | Backlog | Decided not to do this now; keep it for the record |

Mark `[/]` when you start working on a task. Before marking `[x]`, report what you've done and ask the user for confirmation — never mark a task done on your own.

**You MUST mark `[/]` in two situations:**
1. **Creating a task you are already working on.** If you add a task for work that is in progress right now, create it as `[/]`, not `[ ]`.
2. **Starting to execute a task.** When the user asks you to work on a task (or you begin work on one), update it to `[/]` *before* doing the actual work. Don't wait until you're done.

## Writing Tasks

Each task has three parts: a **title** (the `- [ ]` line), a **description** (indented lines explaining context), and an **AC** (acceptance criteria).

### Acceptance Criteria

AC defines "done" before work begins. It should be:

- **Testable**: Someone can objectively judge pass or fail. "Performance is good" is not an AC. "F1 > 0.85 on the test split" is.
- **Implementation-agnostic**: Describes *what* the outcome must satisfy, not *how* to get there. Once you specify algorithms or code structure in the AC, you've moved from spec to implementation.
- **Minimal yet sufficient**: Cover what matters, but don't over-constrain. Too many conditions push toward satisfying clauses rather than solving the problem.

AC should be **black-box**: it describes observable behavior of the final deliverable, not internal implementation details. "Model produces correct answers on the test split" is a good AC. "Unit tests pass" or "code compiles without errors" are not — they verify internals, not whether the thing actually works when you use it.

**Good AC:**
```
- [ ] Run GEPA baseline #run-gepa-baseline
    - Set up official GEPA, configured to match our experimental setup with the same data splits and a comparable memory module.
    - AC: GEPA's optimized prompt and corresponding test score on LoCoMo, evaluated on the same train/val/test split as Engram.
```

**Bad — AC specifies implementation:**
```
- [ ] Run GEPA baseline #run-gepa-baseline
    - AC: Clone repo, apply patch to config.yaml, run `python main.py --dataset locomo`, collect scores.
```

**Bad — AC depends on experimental outcome:**
```
- [ ] Add WebArena benchmark #add-webarena-benchmark
    - AC: Engram achieves +10pp advantage over seed programs.
```

**Fixed:**
```
- [ ] Add WebArena benchmark #add-webarena-benchmark
    - AC: Benchmark integrated; all configs (No Memory, Vanilla RAG, Engram) produce test scores on the hosted instance.
```

### Task granularity

A task should be a **complete, meaningful unit of work** with a tangible deliverable — not a small research step or preparatory action. If the title could be paraphrased as "look into X" or "figure out Y", it's too small. Fold it into a larger task that produces something concrete.

**Too small:**
```
- [ ] Research ALFWorld macOS compatibility #research-alfworld-macos
- [ ] Read GEPA paper and summarize approach #read-gepa-paper
- [ ] Check if WebArena Docker images work #check-webarena-docker
```

**Right size:**
```
- [ ] Add ALFWorld benchmark support #add-alfworld-benchmark
- [ ] Run GEPA baseline on LoCoMo #run-gepa-locomo
- [ ] Deploy WebArena-Verified environments #deploy-webarena-envs
```

Research, investigation, and exploration are *steps within a task*, not tasks themselves. The task title should describe the end result, not the process.

### When adding a new task

If the user asks you to add a task without providing an AC, warn them and suggest one. Don't refuse the edit, but flag the gap:

> "Added the task. It doesn't have an acceptance criterion yet — here's a suggestion: `AC: ...`. Want me to add it?"

### Formatting rules

- No blank lines between list items within a phase.
- Description lines are indented under the task title.
- AC lines start with `AC:` for easy scanning.
- One task = one deliverable. If a task has multiple independent deliverables, split it.

### Task IDs

Every task carries a short, human-readable ID appended to the title line as a `#slug` tag. The slug is 3–4 lowercase words joined by hyphens, e.g. `#fix-auth-bug`. It must be unique within the file.

```
- [ ] Fix Login Page Auth Bugs #fix-auth-bug
    - Users intermittently get 403 when logging in with SSO.
    - AC: SSO login succeeds on all tested providers; no 403 in logs.
```

IDs are useful for referencing tasks in commits, conversations, and branch names. When creating a task, always generate an ID from the title. When the user specifies an ID, use it as-is.

## Phase Goals

Each phase opens with a `Goal:` paragraph. This serves as a soft gate — it describes both why this phase exists and what "enough to move on" looks like. It's not a binary pass/fail; it's a judgment call informed by the goal description.

When a phase's goal is substantially met (even if some tasks remain), it's reasonable to start work on the next phase's tasks that don't depend on the remaining items. This is phase overlap, and it's fine — just be aware of which conclusions are stable and which aren't.

## Completing Tasks

When you finish working on a task, follow this sequence:

1. **Add a `CM:` line** (completion memo) under the task description — one or two sentences recording what was actually done, key decisions made, or unexpected findings. This turns TASKS.md into a lightweight record of outcomes.
2. **Ask the user for confirmation.** Report what you did and let them decide whether the task is done. Do NOT mark `[x]` yourself.
3. **Mark `[x]` only after the user confirms.**

```
- [x] Fix Login Page Auth Bugs #fix-auth-bug
    - Users intermittently get 403 when logging in with SSO.
    - AC: SSO login succeeds on all tested providers; no 403 in logs.
    - CM: Root cause was stale CSRF tokens after IdP redirect. Added token refresh on the callback route. Tested with Google, Okta, and Azure AD.
```

When a task turns out to be unnecessary, superseded, or deferred, mark it `[-]` rather than deleting it. The record of "we decided not to do this now" is valuable context.

## Dashboard

The plugin includes an interactive kanban dashboard. Use the `/dashboard` command or run `task-dashboard` from your terminal to start it.

The dashboard runs at `http://localhost:3847`. The index page lists all projects (discovered from `~/.claude/projects/`) that have a TASKS.md file. Click a project to open its dashboard. The dashboard:

- **Left sidebar**: Phase overview with progress bars, goals, and per-phase status counts. Click a phase to filter.
- **Four status columns**: Ongoing, Pending, Done, Backlog — tasks grouped by phase within each column.
- **Drag-and-drop**: Drag cards between columns to change status, or reorder within a column.
- **Auto-save**: Changes save automatically to disk via the backend API.
