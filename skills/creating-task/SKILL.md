---
name: creating-task
description: Create a new task or section in TASKS.md. Use this whenever the user wants to add, plan, or track work — even if they don't say "task" explicitly. Trigger on "add a task", "new task", "track this", "we should", "let's plan", "add a section", "create section", "I need to", "todo", "can you add", "put this on the board", or when the user describes future work that isn't in TASKS.md yet. Also use when creating a TASKS.md from scratch for a new project. When in doubt, use it — untracked work is invisible work.
---

## Context

- User's instruction: {{ARGS}}

## What this command does

Creates tasks or sections in TASKS.md. The user invoked this command — act immediately, do not ask for confirmation.

Do NOT say: "Should I", "Want me to", "Shall I", "Would you like me to", "Let me know if".

## Workflow

### 1. Read TASKS.md

Read TASKS.md. If it doesn't exist, create one from the template at `${CLAUDE_PLUGIN_ROOT}/skills/octask/references/template.md` (ask the user for a project title first).

### 2. Write the entry

If the task doesn't already exist in the file, write it with Edit. Do not read any other files.

**Where to put it**: Append at the end of the user-specified section's task list. If no section specified, use the last section that has `[ ]` or `[/]` tasks. If there are no sections (tasks live directly under `# TASKS`), append at the end of the task list.

**Status symbols**: `[ ]` todo (default), `[/]` ongoing, `[x]` done, `[-]` backlog. Use `[/]` if the user wants it done now — then continue as `/starting-task`.

**Task format** — each task is a `- [status]` line with a `#slug` at the end, followed by indented description and `AC:` lines. No blank lines between tasks. Example:

```
- [ ] Fix login page auth bugs #fix-auth-bug
    Users intermittently get 403 when logging in with SSO.
    AC: SSO login succeeds on all tested providers; no 403 in logs.
- [ ] Add rate limiting to API endpoints #add-rate-limiting
    Public endpoints have no throttling, vulnerable to abuse.
    AC: Endpoints return 429 after exceeding configured request threshold.
```

Key rules:
- **Slug**: 3-4 lowercase hyphenated words at the end of the title line, prefixed with `#`. Must be unique in the file.
- **Description**: Indented 4 spaces under the title. Write from the user's args only — do not explore the codebase.
- **AC**: Required. Indented 4 spaces, starts with `AC:`. Describes observable outcome, not implementation steps. Use the user's if provided, otherwise write one yourself.

**Section format** — `## Name` header followed by an optional `Description:` paragraph, then tasks:

```
## Authentication
Description: User login and session management improvements.

- [ ] Fix login page auth bugs #fix-auth-bug
    ...
```

When creating a section, suggest 3-5 initial tasks.

### 3. Confirm

One or two lines:

> Created `#fix-auth-bug` (todo). AC: SSO login succeeds on all tested providers.

### 4. Resume prior work

If triggered mid-task, resume whatever you were doing before.
