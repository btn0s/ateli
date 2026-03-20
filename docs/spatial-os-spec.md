# Ateli Spatial OS — Research & Spec

## Vision

The canvas is a spatial operating system. Shapes are the universal primitive.
Frames are containers. Agents read their spatial context to understand what
they're working on. Everything composes from small pieces.

## Philosophy

- **Unix-like**: small primitives that compose, not rigid systems
- **Fluid**: drag anything onto the canvas, it becomes a shape
- **Composable**: select shapes → group into frame → label it → feed to agent
- **No special types**: a Linear ticket, a screenshot, a note — all just shapes
  with different renderers

## What Exists Today

- [x] Electron desktop app with tldraw infinite canvas
- [x] Custom terminal shape (xterm.js + node-pty)
- [x] tmux-backed terminal sessions (persist across restarts)
- [x] JSON-RPC server over Unix socket (~/.collaborator/socket-path)
- [x] RPC methods: canvas.createTerminal, terminal.exec/read/write/list/sendKeys
- [x] Canvas persistence per folder via tldraw persistenceKey
- [x] Custom dot grid with cursor spotlight glow
- [x] Frameless window with custom titlebar
- [x] Agent-to-agent communication (Claude instances talking through terminals)

## Proposed Primitives

### 1. Universal Card Shape

Any external content becomes a shape on the canvas. One generic card shape:

```
{
  type: "card",
  props: {
    w, h,
    title: string,
    body: string,        // markdown
    url?: string,        // source link (Linear ticket, GitHub PR, etc)
    sourceType?: string, // "linear", "github", "url", "note", etc
    meta?: object,       // arbitrary metadata from the source
  }
}
```

The card renders a preview based on sourceType. No special "LinearCard" or
"GitHubCard" — one shape, many renderers.

**Open questions:**
- How does content get onto the canvas? Drag-and-drop from browser? Paste URL?
  RPC method? All three?
- Should cards be editable (like notes) or read-only references?
- How do we render previews for different source types?

### 2. Frames as Labeled Containers

tldraw already has frame shapes with `{ name, w, h, color }` props. We use
them as-is for spatial organization:

- Select shapes → Cmd+G → creates frame around them
- Frame gets a name label (editable)
- Drag shapes in/out of frames
- Frames can nest

No status, no special behavior. A frame is a folder.

**Open questions:**
- Should agents auto-create frames, or only humans?
- Do we need RPC methods for frame CRUD, or is tldraw's built-in enough?
- How does an agent know which frame it's "in"? By parentId ancestry?

### 3. Agent Context Reading

The key primitive: an agent can ask "what's around me?"

```
RPC: workspace.context({ sessionKey })
→ Returns:
  - frame: { id, name } (the frame this terminal is in, if any)
  - siblings: [{ id, type, title, body, url, ... }] (other shapes in the frame)
  - nearby: [{ id, type, distance }] (shapes within N px, if not in a frame)
```

Spatial proximity = context. An agent in a frame with a Linear ticket card
automatically knows what ticket it's working on.

**Open questions:**
- What's the right context radius for "nearby" when not in a frame?
- Should context include shapes in nested sub-frames?
- How much content to include? Full body text or just titles?
- Performance: how often will agents call this? Cache?

### 4. Drop Target / Paste Handler

The canvas accepts external content:

- Drag URL from browser → creates card shape with fetched title/preview
- Paste text → creates note shape
- Paste URL → creates card shape
- RPC: canvas.createCard({ title, body, url, sourceType, x, y })

**Open questions:**
- Can we detect Linear ticket URLs and auto-fetch title/description via MCP?
- What about images/screenshots? Separate shape type or card with image?
- Drag-and-drop from Finder (files)?

## Non-Goals (for now)

- Linear sync / bidirectional updates
- Status systems or dashboards
- Special workspace shape types
- Auto-layout / arrangement
- Multi-user / collaboration

## Architecture Notes

- tldraw's `frame` shape already supports parentId containment, reparenting,
  spatial queries (getShapeIdsInsideBounds), and fitFrameToContent
- The RPC socket is the agent interface — all new primitives are RPC methods
- Custom shapes register via shapeUtils array on the Tldraw component
- Canvas persists to localStorage keyed by folder path

## Next Steps

1. Spec out the card shape (minimal viable version)
2. Add RPC method for agent context reading
3. Add paste/drop handling for URLs
4. Create Linear issues for each work item
