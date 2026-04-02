# Worktree Support — Design Spec

## Overview

Add git worktree management to ateli so agents and users can run work in
isolated branches. Worktrees are created/listed/removed via RPC methods.
Terminals can be spawned with their cwd set to a worktree path, giving
full isolation. No new UI — everything is RPC-driven, matching the
"rich internals, simple surface" principle.

## Motivation

Running multiple agent sessions on the same repo causes conflicts — agents
step on each other's file changes. Git worktrees give each agent its own
working directory on its own branch, backed by the same repo. This is how
Conductor solves isolation.

## Scope

**In scope:**
- `worktree.create` — create a git worktree on a new or existing branch
- `worktree.list` — list active worktrees with branch/path info
- `worktree.remove` — remove a worktree, kill associated terminals
- `worktree.createSpace` — create worktree + terminal in one call
- Persist worktree metadata to `~/.ateli/worktrees.json`
- Cleanup: remove worktree also removes its directory and prunes git refs

**Deferred:**
- Config sync (.env copying/symlinking)
- Setup scripts
- Checkpoints
- Worktree state machine (initializing → ready)
- UI for worktree management

## Architecture

### Module: `src/main/worktree.ts`

Pure git operations — no Electron dependency. Functions:

```typescript
interface WorktreeInfo {
  path: string
  branch: string
  head: string // commit SHA
  isMain: boolean
}

// Create a new worktree. If createBranch is true, creates the branch first.
async function addWorktree(opts: {
  repoPath: string
  worktreePath: string
  branch: string
  createBranch?: boolean
  startPoint?: string // base branch/commit, defaults to HEAD
}): Promise<void>

// List all worktrees for a repo
async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]>

// Remove a worktree and prune
async function removeWorktree(repoPath: string, worktreePath: string): Promise<void>

// Get the current branch of a repo/worktree
async function getCurrentBranch(repoPath: string): Promise<string>
```

All operations use `execFile("git", [...args])` — no shell, no injection risk.

### RPC Methods

Added to `src/main/rpc.ts`, delegating to worktree.ts and PtyManager:

| Method | Params | Returns | Description |
|---|---|---|---|
| `worktree.create` | branch, createBranch?, startPoint? | { id, path, branch } | Create worktree |
| `worktree.list` | — | { worktrees: [...] } | List all worktrees |
| `worktree.remove` | id | { ok } | Remove worktree + kill terminals |
| `worktree.createSpace` | branch, createBranch?, startPoint? | { worktree, terminal } | Create worktree + terminal |

### State Persistence

**`~/.ateli/worktrees.json`** — worktree metadata registry:

```typescript
interface WorktreeMetadata {
  id: string
  repoPath: string       // the main repo path
  worktreePath: string   // the worktree directory
  branch: string
  createdAt: string
}
```

Managed by PtyManager-style pattern: atomic writes, immediate on create/delete.
The worktree path is derived: `~/.ateli/worktrees/{repoPath-hash}/{branch-slug}/`

This keeps worktrees in a predictable location outside the repo, avoiding
cluttering the project directory.

### Terminal Binding

`worktree.createSpace` does:
1. Call `worktree.create` to make the worktree
2. Call `ptyManager.createSession({ cwd: worktreePath, name: branch })`
3. Return both the worktree metadata and the terminal session info

When `worktree.remove` is called:
1. Find all terminals whose cwd starts with the worktree path
2. Kill those terminals
3. Remove the worktree directory via git
4. Remove metadata from worktrees.json

### Worktree Path Strategy

Worktrees are stored under `~/.ateli/worktrees/` to keep them out of the
project directory:

```
~/.ateli/worktrees/
  {repo-hash}/           # hash of the repo's absolute path
    {branch-slug}/       # sanitized branch name
      ...working tree files...
```

The repo hash is a short (8-char) hash of the repo path. The branch slug
replaces `/` with `-` and strips unsafe characters.

## File Changes

**New files:**
- `src/main/worktree.ts` — git worktree operations

**Modified files:**
- `src/main/rpc.ts` — add worktree.* RPC methods
- `src/main/pty.ts` — add method to find terminals by cwd prefix
