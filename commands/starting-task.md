---
description: Start working on a task — marks it ongoing in TASKS.md and begins execution. Use this whenever starting a task, beginning work, picking up a task, or when the user says "start", "work on", "do", "let's do", "begin", or references a task by slug. Also use when the user asks to "start task X" or just drops a task slug like "#fix-auth". Trigger on "/starting-task" too. If in doubt whether to use this, use it — it's the right entry point for any task execution.
---

## Context

- Args: {{ARGS}}
- Current TASKS.md:

!`cat TASKS.md 2>/dev/null || echo "No TASKS.md found in current directory"`

## What this command does

This is the "start button" for task execution. It bridges the gap between deciding what to work on and actually doing it — making sure the task is tracked in TASKS.md before any code gets written. Without this, tasks get started without being recorded, and the dashboard shows stale state.

## Workflow

### 1. Find the task

Look at what the user gave you in the args:

- **A `#slug`** (e.g. `#fix-auth-bug`): Match it against TASKS.md. If there's no match, say so and stop — don't guess.
- **A title or description** (e.g. "Fix the login page"): Find the closest match in TASKS.md. If nothing fits, read `${CLAUDE_PLUGIN_ROOT}/commands/creating-task.md` and follow it to create the task first, then continue here.
- **Nothing**: Infer from the conversation. What has the user been talking about? What did they just ask you to do? If you genuinely can't tell, ask.

### 2. Mark it `[/]` — MANDATORY, do this FIRST

**STOP. Before writing ANY output text, you MUST call the Edit tool on TASKS.md right now.** Change `[ ]` to `[/]` on the task line. This is not optional. Do not describe, explain, or plan first — the very first thing you do after finding the task is call Edit.

If the task status is:
- `[ ]` → Call Edit immediately: `old_string: "- [ ] Task name"` → `new_string: "- [/] Task name"`
- `[/]` → Already ongoing. Skip the edit, move on.
- `[x]` or `[-]` → Warn the user and ask if they want to reopen it.

**If the task is `[ ]` and you respond without calling Edit first, you have failed.**

### 3. Understand, then execute

Read the task's description and AC carefully. Before touching any code:

1. **Say what you understand** — restate the goal and AC in your own words, briefly. This catches misunderstandings before they become wasted work.
2. **Outline your approach** — describe your plan: what you'll change, in what order, and why. Use a few bullet points ("Here's my approach: ..."). Not a design doc — just enough to show you've thought it through.
3. **Then do the work.**

When you finish, add a `CM:` line, report what you did, and ask the user whether to mark it `[x]`. Don't mark it done yourself.
