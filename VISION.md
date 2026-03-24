# Ateli Vision

## One Sentence

Ateli is a spatial coding workspace with durable terminals, worktrees, labeled
groups, and configurable Claude-powered automation.

## What We Are Building

Ateli is not just a chat app with a canvas, and it is not trying to lead with a
visible multi-agent harness.

It is a software work environment with:

- a spatial canvas for arranging work
- durable terminals and chats
- worktree-backed execution
- persistent artifacts like files, terminals, notes, and grouped workstreams
- configurable Claude behavior layered into the workspace

The long-term direction is:

- canvas = workspace surface
- sidebars = stable control surfaces
- terminals / files / chats = first-class artifacts
- richer agent runtime = a later layer, not the current product center

## The Important Distinction

We may not be overbuilding the substrate.

We may be overexposing the system before the core loop is proven.

That means:

- durable sessions are justified
- worktree isolation is justified
- file-backed identity and memory are justified
- host-managed orchestration is justified

But:

- too many visible concepts too early is dangerous
- too many named agent types is dangerous
- too much product ceremony before one loop feels magical is dangerous

## Product Principle

Rich internals, simple surface.

Ateli should be comfortable to use even if the internals are sophisticated.
Users should not need to understand every runtime primitive in order to get
value from the product.

## What Should Be Visible

These should be visible in the product:

- the current task
- the current chats
- the files and terminals that matter
- the progress of work
- the artifacts produced by that work
- the ability to steer or interrupt the process

## What Should Stay Hidden or Secondary

These can exist without being front-and-center in the UX:

- session IDs
- worktree plumbing
- identity implementation details
- memory implementation details
- orchestration internals
- context assembly internals

The user should feel the benefits of those systems without being forced to
manage them directly.

## Smallest Lovable Loop

The core loop we need to prove is:

1. A user opens a repo in Ateli.
2. They create or organize a workstream on the canvas.
3. They attach a durable terminal and bind it to a worktree.
4. They do real software work with Claude-powered automation available.
5. The outputs stay visible and durable across the workspace.
6. Nothing important is lost on reload or restart.

If this loop works, the rest of the system is justified.

If this loop does not work, the rest of the system will feel like overkill.

## Current Product Thesis

Ateli is a spatial coding workspace.

More concretely:

Ateli is an operating environment where software work happens through durable
terminals, files, worktrees, chats, and artifacts arranged in space.

## Immediate Product Priorities

In the near term, we should optimize for:

- making the workspace shell feel coherent
- making groups and workstreams useful
- making durable terminals and worktrees feel natural
- keeping Claude configuration powerful but unobtrusive

## Explicit Non-Goal

We are not trying to expose every system concept as UI.

We are trying to make software work legible, steerable, and durable.

That is the bar.
