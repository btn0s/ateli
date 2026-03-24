# PRD: Ateli Workspace-First

## Status

Active

## Summary

Ateli should be a workspace-first product.

The near-term product is not a visible multi-agent harness. It is a spatial
coding workspace with durable terminals, worktrees, groups, files, and Claude
configuration, built in our own stack.

Short product definition:

Ateli is a spatial coding workspace with durable terminals, worktrees, labeled
groups, and configurable Claude-powered automation.

## Product Thesis

People doing software work need more than a chat box and more than a flat IDE.
They need a place where parallel workstreams, terminals, plans, files, and
automation can stay visible and durable.

Ateli should feel like:

- Collaborator in our stack
- with better durability
- with worktree-native execution
- with grouping and labeling that reflects real software work
- with a clean path to richer agent behavior later

## Problem

Today, software work is split across too many disconnected surfaces:

- IDE
- terminal
- chat
- task tracker
- scratch notes

Existing agent tools also tend to be either:

- too ephemeral
- too hidden
- too chat-centric
- too hard to steer once work starts

We want a workspace where:

- terminals persist
- workstreams can be grouped visually
- automation can be configured globally
- nothing important disappears on refresh

## Goals

- Preserve the canvas as the main spatial surface.
- Make terminals first-class and durable.
- Make worktree-backed execution easy and default.
- Make groups/frame-like containers useful for real workstreams.
- Add a stable shell around the canvas for navigation, files, and terminals.
- Add global Claude config / skills management.
- Keep room for future agent orchestration without making it the primary UX yet.

## Non-Goals

- Making visible multi-agent orchestration the core product right now.
- Requiring users to think in terms of agent identity, memory, or session IDs.
- Replacing the terminal with a fully abstract agent UI.
- Building a full PM system inside Ateli in this phase.

## Core Product Principles

### 1. Workspace-first, not harness-first

The visible product should be a spatial coding workspace.

Agent runtime ideas may exist behind the scenes or in experimental tracks, but
they should not dominate the surface area until the core workspace loop is
proven.

### 2. Durable by default

Important state must survive reloads and restarts.

This includes:

- canvas state
- chats
- terminals
- worktree bindings
- configuration

### 3. Rich internals, simple surface

We can build sophisticated substrate, but the visible UX should remain legible.

Users should feel the benefits of:

- persistence
- isolation
- orchestration
- config layering

without being forced to manage those systems directly.

### 4. Live views over real artifacts

Shapes and panels should increasingly be live views over real things:

- terminals over tmux sessions
- file views over files on disk
- chats over durable sessions
- groups over real workstreams

## Primary User Experience

The user should be able to:

1. Open a workspace.
2. See their canvas, files, and terminal surfaces together.
3. Create labeled groups for distinct workstreams.
4. Open or attach worktrees to those workstreams.
5. Use Claude-powered automation from within the workspace.
6. Resume the whole environment later without losing context.

## Smallest Lovable Loop

The first loop that must feel great:

1. Open a repo in Ateli.
2. Create or organize a workstream on the canvas.
3. Attach a durable terminal to it.
4. Bind it to a worktree.
5. Configure Claude behavior/skills globally or per workspace.
6. Do real software work and come back later without losing state.

If this loop feels good, Ateli is already valuable even before deeper agent
orchestration ships.

## Core Surfaces

### Canvas

The canvas remains the main orchestration surface.

Use it for:

- arranging terminals and artifacts
- grouping related work
- labeling workstreams
- maintaining visual context

### Left Sidebar

The left sidebar is a stable coordination surface.

Near-term uses:

- durable workspace chats
- navigation between chats/workstreams
- lightweight coordination

### Right Sidebar

The right sidebar is a stable operational surface.

Near-term uses:

- file tree
- terminal stack
- eventually config/inspector panels

## Core Primitives

### Durable Terminals

- tmux-backed
- resumable
- spatially placeable
- optionally attached to worktrees or groups

### Groups / Frames

Groups should become a core workspace primitive.

They should support:

- naming
- visual scoping
- grouping terminals and artifacts
- eventually acting as workstream containers

### Worktrees

Worktrees should be first-class in the product model, even if not loudly
surfaced in every UI.

The user should be able to:

- create or attach worktrees
- understand which surface is operating in which worktree
- open the worktree in an IDE quickly

### Claude Config / Skills

Claude configuration should be manageable globally.

This includes:

- available profiles
- default instructions
- skill bundles
- reusable config layers

This should feel like environment configuration, not magical hidden prompt glue.

## Relationship To Agent Runtime Work

The agent runtime direction is still important, but it is no longer the active
product center.

That work should be treated as a separate R&D track:

- isolated agent sessions
- task-shaped identity / SOUL
- preloaded tool/context bundles
- custom Claude CLI wrappers
- supervisor / specialist orchestration

Those ideas may later plug into Ateli, but they do not need to define the
workspace product today.

## Immediate Priorities

1. Make the shell around the canvas coherent.
2. Improve labeled groups / workstream organization.
3. Make worktree usage smoother and more visible.
4. Add global Claude config / skills management.
5. Keep durability strong across every core surface.

## Success Criteria

We will know this direction is working if:

- Ateli is useful even without visible multi-agent orchestration
- users can keep multiple workstreams visible and organized
- durable terminals and worktrees feel natural
- Claude-powered automation feels configurable rather than magical
- returning to the workspace after a restart feels reliable
