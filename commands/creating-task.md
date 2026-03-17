---
description: Create a new task or phase in TASKS.md. Use this whenever the user wants to add, plan, or track work — even if they don't say "task" explicitly. Trigger on "add a task", "new task", "track this", "we should", "let's plan", "add a phase", "create phase", "I need to", "todo", "can you add", "put this on the board", or when the user describes future work that isn't in TASKS.md yet. Also use when creating a TASKS.md from scratch for a new project. When in doubt, use it — untracked work is invisible work.
---

## Context

- Args: {{ARGS}}
- Current TASKS.md:

!`cat TASKS.md 2>/dev/null || echo "No TASKS.md found in current directory"`

## What this command does

Creates tasks or phases in TASKS.md so work is tracked before it begins. The user invoked this command because they want something created — **act immediately without asking**.

**CRITICAL**: Do NOT output any of these phrases: "Should I", "Want me to", "Shall I", "Would you like me to", "Let me know if". The user already confirmed by invoking this command. Just call the Edit tool to write the entry, then output a 1-2 line confirmation of what you created.

## Workflow

### 1. Bootstrap TASKS.md if needed

If there's no TASKS.md in the project, create one from the template at `${CLAUDE_PLUGIN_ROOT}/skills/octask/references/template.md`. Ask the user for a project title and first phase name, then fill in the template before adding the task.

### 2. Create the entry

Parse the args and conversation context, then use `Edit` to write the entry into TASKS.md immediately.

**For a task:**

- **Target phase**: Use the phase the user specified. If none, use the last phase that still has `[ ]` or `[/]` tasks.
- **Slug**: Generate a `#slug` from the title (3-4 lowercase hyphenated words). Must be unique.
- **Status**: Default to `[ ]` (todo). If the user wants this done now (e.g. "do this", "start on this"), mark `[/]` and begin executing — this becomes a `/starting-task` flow.
- **AC**: Always include one. Use the user's if provided; otherwise write a reasonable one yourself.
- **Placement**: Append at the end of the target phase's task list. Follow the `/octask` skill formatting.

If a very similar task already exists, mention it briefly but still create unless it's clearly a duplicate.

**For a phase:**

- Use `## Phase N: Name` with the next sequential number.
- Draft a `Goal:` paragraph from context.
- Insert after the last existing phase.
- Suggest a minimal set of tasks (3-5) for the phase goal, then write them all in one go.

### 3. Confirm briefly

One or two lines is enough:

> Created `#fix-auth-bug` in Phase 2 (todo). AC: SSO login succeeds on all tested providers.

For multiple tasks, a compact bullet list. No tables.

### 4. Resume prior work

If this command was triggered mid-task, create the task, show the brief confirmation, then resume whatever you were doing before.
