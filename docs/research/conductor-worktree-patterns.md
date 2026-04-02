# Conductor Worktree Patterns — Research Notes

Reference: `examples/conductor/` (Tauri desktop app, v0.44.0)

## What Conductor Does

Conductor orchestrates AI coding agents (Claude Code, Codex) with git-based
workspace isolation. Each agent session runs in its own git worktree, giving
it a full working directory on its own branch. This prevents agents from
stepping on each other's changes.

## Worktree Lifecycle

### Creation
- Each "workspace" in Conductor maps to a git worktree branched from the
  main checkout (`mainWorktreePath`)
- Worktree path, branch name, and state are tracked in SQLite
- States: `initializing` → `setting_up` → `ready`

### Config Sync
- `.claude/settings.local.json` is symlinked from the worktree back to the
  main worktree so permission rules apply consistently across all branches
- Only symlinks if the file is git-ignored (checked via `git check-ignore -q`)
- Ensures shared settings without committing them

### Environment Setup
- Shell environment loaded via login shell (`$SHELL -ilc '...'`)
- Layered composition: shell env → process.env → conductor env → user env vars
- Auth tokens (ANTHROPIC_API_KEY etc.) stripped from shell env for safety
- Custom env vars parsed from multiline strings (supports quotes, exports)

### Setup Scripts
- Not present in Conductor per se — Conductor's init flow runs slash command
  introspection and MCP server setup per workspace
- The equivalent in Collaborator is `workspace.setupScript` run via
  `/bin/zsh -lc` with env vars like `ATELI_WORKSPACE_PATH` set

## Terminal Integration

### Session Binding
- Each workspace has associated terminal instances
- Terminals tracked per workspace in a Zustand store
- Default "repo terminal" for the main checkout
- Agent sessions run in the worktree's cwd

### Session Management
- Max 5 concurrent agent sessions
- 30-minute idle timeout with automatic eviction
- Session reuse: if model/settings haven't changed, reuse the generator
- If settings changed, tear down and recreate

### Communication
- Tauri shell plugin for terminal spawning (`plugin:shell|spawn`)
- stdin/stdout piped via Tauri IPC
- Separate from the sidecar Node.js process

## Checkpoint System

### How It Works
- Non-disruptive git snapshots using private refs (`refs/conductor-checkpoints/`)
- Checkpoints taken at turn boundaries (before and after each agent turn)
- Uses a temp git index to capture working tree state without touching HEAD

### Operations
- `save` — capture HEAD OID + index tree + working tree into a ref
- `restore` — `reset --hard` + `read-tree` + `clean -fd` to restore
- `diff` — compare checkpoint vs current working tree

### Trigger Points
- `UserPromptSubmit` hook → save "start" checkpoint
- `Stop` hook → save "end" checkpoint
- Enables rollback to any turn boundary

## Directory Sandboxing

### Write Protection
- Write tools (Edit, Write, NotebookEdit) are sandboxed to allowed directories
- `cwd` + `additionalDirectories` are the allowed set
- Both resolved and real paths checked (handles symlinks)
- Files outside allowed paths → tool denied with clear error message

### Additional Directories
- Sessions can specify extra writable directories beyond cwd
- Passed to Claude Code CLI via `--add-dir` flags
- Use case: agent needs to write to a docs/ dir outside the worktree

## Tool Permission System

### Three Layers
1. **ExitPlanMode** — special case for plan approval flow
2. **Directory sandboxing** — file writes restricted to allowed paths
3. **Managed tool approval** — user can approve/deny tool use per session

### Approval Options
- `deny` — block the tool call
- `allow_edits_for_session` — auto-approve all file edits for this session
- `allow_with_permissions` — allow with specific permission rules
- `always_allow` — persist the permission rule

## What We Should Adopt

### Now (worktree.create MVP)
- Git worktree creation with branch isolation
- Terminal binding (cwd = worktree path)
- Worktree metadata persistence
- Clean removal (kill terminals, remove directory, prune refs)

### Next (config sync)
- .env file copying from main repo to worktree
- Settings symlink for shared Claude config
- Configurable file list (workspace-level policy)

### Later (full lifecycle)
- Setup scripts that run after worktree creation
- Checkpoint system for rollback
- Directory sandboxing for agent writes
- State machine (initializing → ready)
- Session idle timeout and eviction

### Probably Never (different approach in ateli)
- Conductor's Tauri shell plugin (we have sidecar PTY)
- SQLite state storage (we use JSON files)
- Conductor's MCP server tools (we'll have our own)
- Conductor's UI patterns (we have tldraw canvas)
