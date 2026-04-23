# Feature: Explicit "Kill session" action

> Feature prompt — product-level. Implementation choices are Codex's to make.

## What we're building

Today, the only way to end a terminal session is to delete its view (canvas shape or sidebar tab). That's an accidental consequence of the UI, not an explicit user action. Ship an explicit way to kill the underlying PTY.

## User stories

- **On the canvas:** right-click a terminal shape → a "Kill session" menu item appears. Clicking it ends the PTY process. The shape stays visible briefly with a final "[process killed]" line rendered, then closes.
- **In the sidebar:** right-click a terminal tab → same "Kill session" menu item. Same behavior.
- **Keyboard:** when a terminal view is focused, a keyboard shortcut (propose `Ctrl+Shift+K` / `Cmd+Shift+K`) triggers the same action.
- **Confirmation:** killing a running process is destructive and non-undoable. Show a lightweight confirm dialog first — same pattern as the existing "delete shape" confirm. If the only thing running in the shell is the shell itself (no foreground process), the confirm can be skipped. Codex's call on how to detect "nothing running."

## Behavior contract

- Kill = `SIGTERM` to the PTY process. If the PTY doesn't exit within a short window (~500ms), escalate to `SIGKILL`. Sidecar supports signaling already via `session.signal`; surface it or use whatever primitive fits.
- Kill is distinct from **close view**: closing a view (delete shape / close tab) should continue to work the way it does today, since today every session has exactly one view. (The refcount infra from the session-as-object refactor already supports multi-view; this ships explicit kill regardless of view count.)
- After a session is killed, any remaining views for that session should close naturally.

## Acceptance

- `pnpm --filter desktop build` passes.
- Right-clicking a canvas terminal shape shows the "Kill session" menu item.
- Right-clicking a sidebar terminal tab shows the same item.
- Keyboard shortcut works when a terminal is focused.
- Clicking it with a long-running process (e.g. `sleep 9999`) surfaces the confirm dialog, killing on confirm.
- Clicking it with just an idle shell prompt skips confirm (or shows confirm — Codex's judgment).
- The view closes after the session dies; no dangling shapes/tabs.
- Existing shape-delete / tab-close flows still work unchanged.

## Guardrails

- Don't touch the sidecar protocol except via existing methods (`session.kill`, `session.signal`, etc.). Don't add new IPC surface in main unless unavoidable.
- Don't regress the existing confirm-on-delete UX in `canvas.tsx`.
- Don't introduce new deps. Use the shadcn primitives already in the app for any dialog UI.
- Follow conventional commit style (`feat(desktop): …`).
- Commit in logical chunks (e.g. one for the kill primitive wiring, one for the canvas UI, one for the sidebar UI, one for the keyboard shortcut).

## Handoff

```bash
node "/Users/btn0s/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs" \
  task --background --write --effort high \
  "$(cat docs/plans/2026-04-23-kill-session-action.md)"
```
