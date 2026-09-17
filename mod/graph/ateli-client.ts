import { atom, type Editor, type JsonValue, type TLShapeId } from 'tldraw'
import { getTool, type AteliTool, type AteliValueType } from './ateli-tools'

export const ATELI_ORIGIN = 'http://127.0.0.1:7237'
const ATELI_API = `${ATELI_ORIGIN}/ateli`

export interface AteliGraph {
	nodes: Array<{ id: string; toolId: string; toolVersion: 1; parameters: Record<string, JsonValue> }>
	edges: Array<{ id: string; source: { nodeId: string; portId: string }; target: { nodeId: string; portId: string } }>
}
export type AteliRunScope = { kind: 'graph' } | { kind: 'node'; nodeId: string } | { kind: 'downstream'; nodeId: string }
export type AteliRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export interface AteliBatchItems {
	total: number
	done: number
	failed: number
}
export interface AteliNodeRunState {
	status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cached'
	error?: string
	outputs: Record<string, string>
	items?: AteliBatchItems
}
export interface AteliStatusResponse {
	runId: string
	status: AteliRunStatus
	progress: number
	nodes: Record<string, AteliNodeRunState>
}
export interface AteliResultItem {
	resultId: string
	name: string
	previewUrl: string
	downloadUrl: string
	value?: JsonValue
}
type AteliResultKind = Exclude<AteliValueType, 'enum'>
export type AteliResult = {
	resultId: string
	kind: Exclude<AteliResultKind, `${string}[]`>
	name: string
	size: number
	sha256: string
	value?: JsonValue
	downloadUrl: string
	previewUrl: string
} | {
	resultId: string
	kind: Extract<AteliResultKind, `${string}[]`>
	items: Array<AteliResultItem | null>
}

function absoluteUrl(url: string) {
	if (!url || /^https?:\/\//.test(url)) return url
	return `${ATELI_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`
}

function absoluteResult(result: AteliResult): AteliResult {
	if ('items' in result) {
		return {
			...result,
			items:result.items.map(item => item && {
				...item,
				downloadUrl:absoluteUrl(item.downloadUrl),
				previewUrl:absoluteUrl(item.previewUrl),
			}),
		}
	}
	return { ...result, downloadUrl:absoluteUrl(result.downloadUrl), previewUrl:absoluteUrl(result.previewUrl) }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${ATELI_API}${path}`, init)
	if (!response.ok) {
		const body = await response.text()
		throw new Error(body || `Ateli request failed (${response.status})`)
	}
	return response.json() as Promise<T>
}

export const client = {
	tools() {
		return request<AteliTool[]>('/tools')
	},
	uploadSource(file: File) {
		const body = new FormData()
		body.append('file', file)
		return request<{ sourceId: string; sha256: string; size: number; name: string; kind: 'image' | 'mesh' | 'video' }>('/sources', { method:'POST', body })
	},
	run(graph: AteliGraph, scope: AteliRunScope, cache?: boolean) {
		return request<{ runId: string; status: 'queued' }>('/runs', {
			method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ graph, scope, ...(cache === undefined ? {} : { cache }) }),
		})
	},
	status(runId: string) {
		return request<AteliStatusResponse>(`/runs/${encodeURIComponent(runId)}`)
	},
	async result(id: string) {
		return absoluteResult(await request<AteliResult>(`/results/${encodeURIComponent(id)}`))
	},
	clearCache(nodeId: string) {
		return request<unknown>(`/cache/${encodeURIComponent(nodeId)}`, { method:'DELETE' })
	},
	cancel(runId: string) {
		return request<AteliStatusResponse>(`/runs/${encodeURIComponent(runId)}/cancel`, { method:'POST' })
	},
}

interface SerializedNodeProps { toolId: string; values: Record<string, JsonValue> }
interface SerializedEdgeProps { from: TLShapeId; fromPort: string; to: TLShapeId; toPort: string }

export function serializeAteliGraph(editor: Editor): AteliGraph {
	const shapes = editor.getCurrentPageShapes()
	const edges = shapes.filter(shape => shape.type === 'ateli-edge') as Array<(typeof shapes)[number] & { props: SerializedEdgeProps }>
	const connectedInputs = new Set(edges.map(edge => `${edge.props.to}\u0000${edge.props.toPort}`))
	return {
		nodes: shapes.filter(shape => shape.type === 'ateli-node').flatMap(shape => {
			const props = shape.props as unknown as SerializedNodeProps
			const tool = getTool(props.toolId)
			if (!tool) return []
			const parameters: Record<string, JsonValue> = {}
			for (const input of tool.inputs) {
				if (connectedInputs.has(`${shape.id}\u0000${input.id}`)) continue
				const value = props.values[input.id]
				if (value !== undefined) parameters[input.id] = value
			}
			return [{ id:shape.id, toolId:tool.id, toolVersion:tool.version, parameters }]
		}),
		edges: edges.map(edge => ({
			id:edge.id,
			source:{ nodeId:edge.props.from, portId:edge.props.fromPort },
			target:{ nodeId:edge.props.to, portId:edge.props.toPort },
		})),
	}
}

const pollDelayMs = 750
const terminalStatuses = new Set<AteliRunStatus>(['completed', 'failed', 'cancelled'])

// Session-only run state. It is never written into shape props: a document reopened after the bridge died
// must not show nodes as running, and one editor drives at most one run at a time.
export type AteliNodeLiveState = {
	status: 'queued' | 'running'
	items?: AteliBatchItems
}
export interface AteliActiveRun { runId: string; nodes: Record<string, AteliNodeLiveState> }
export const activeRun = atom<AteliActiveRun | null>('ateli active run', null)

function resultProps(result: AteliResult): Record<string, JsonValue> {
	if ('items' in result) {
		return {
			resultId:result.resultId,
			kind:result.kind,
			items:result.items.map(item => item && {
				resultId:item.resultId,
				name:item.name,
				previewUrl:item.previewUrl,
				downloadUrl:item.downloadUrl,
				...(item.value === undefined ? {} : { value:item.value }),
			}),
		}
	}
	return {
		resultId:result.resultId,
		previewUrl:result.previewUrl,
		kind:result.kind,
		...(result.value === undefined ? {} : { value:result.value }),
	}
}

function nodeErrorMessage(error: unknown, items?: AteliBatchItems) {
	const message = error instanceof Error ? error.message : String(error)
	if (!items) return message
	const progress = `${items.done}/${items.total}${items.failed ? ` · ${items.failed} failed` : ''}`
	return message ? `${progress} · ${message}` : progress
}

function setNodeError(editor: Editor, nodeId: TLShapeId, error: unknown, items?: AteliBatchItems) {
	const shape = editor.getShape(nodeId)
	if (shape?.type !== 'ateli-node') return
	editor.updateShape({ id:nodeId, type:'ateli-node', props:{ results:{ error:nodeErrorMessage(error, items) } } })
}

export async function cancelAteliRun() {
	const run = activeRun.get()
	if (!run?.runId) return
	await client.cancel(run.runId).catch(() => undefined)
}

export async function runAteliGraph(editor: Editor, scope: AteliRunScope, cache?: boolean) {
	if (activeRun.get()) return undefined
	const initiatingNodeId = scope.kind === 'graph' ? undefined : scope.nodeId as TLShapeId
	// A fresh attempt clears the last error on the node that asked for it; other nodes keep theirs until they run.
	if (initiatingNodeId) {
		const shape = editor.getShape(initiatingNodeId)
		if (shape?.type === 'ateli-node' && 'error' in shape.props.results) {
			const { error: _error, ...rest } = shape.props.results
			editor.updateShape({ id:initiatingNodeId, type:'ateli-node', props:{ results:rest } })
		}
	}
	// Claim the slot before the first await so two clicks in the same frame cannot both submit.
	activeRun.set({ runId:'', nodes:{} })
	let runId: string | undefined
	try {
		const graph = serializeAteliGraph(editor)
		console.info('[ateli] run', scope, `${graph.nodes.length} nodes, ${graph.edges.length} edges`, graph.edges.map(e => `${e.source.nodeId.slice(-6)}.${e.source.portId}→${e.target.nodeId.slice(-6)}.${e.target.portId}`))
		const submitted = await client.run(graph, scope, cache)
		console.info('[ateli] run accepted', submitted.runId)
		runId = submitted.runId
		activeRun.set({ runId, nodes:{} })
		const loadedResults = new Map<string, AteliResult>()
		for (;;) {
			const status = await client.status(runId)
			const live: Record<string, AteliNodeLiveState> = {}
			for (const [nodeId, node] of Object.entries(status.nodes)) {
				const shape = editor.getShape(nodeId as TLShapeId)
				if (!shape || shape.type !== 'ateli-node') continue
				if (node.status === 'queued' || node.status === 'running') {
					live[nodeId] = { status:node.status, ...(node.items ? { items:node.items } : {}) }
					continue
				}
				if (node.status === 'skipped') continue
				const outputEntries = await Promise.all(Object.entries(node.outputs).map(async ([portId, resultId]) => {
					let result = loadedResults.get(resultId)
					if (!result) {
						result = await client.result(resultId)
						loadedResults.set(resultId, result)
					}
					return [portId, result] as const
				}))
				const results: Record<string, JsonValue> = Object.fromEntries(outputEntries.map(([portId, result]) => [portId, resultProps(result)]))
				if (node.status === 'failed') results.error = nodeErrorMessage(node.error ?? 'Node failed', node.items)
				if (JSON.stringify(shape.props.results) !== JSON.stringify(results)) editor.updateShape({ id:shape.id, type:'ateli-node', props:{ results } })
			}
			if (terminalStatuses.has(status.status)) return status
			activeRun.set({ runId, nodes:live })
			const { promise: tick, resolve: wake } = Promise.withResolvers<void>()
			setTimeout(wake, pollDelayMs)
			await tick
		}
	} catch (error) {
		// Submission was rejected, or the bridge went away mid-run. Every node that was in flight learns why.
		const inFlight = Object.keys(activeRun.get()?.nodes ?? {}) as TLShapeId[]
		for (const nodeId of inFlight.length ? inFlight : initiatingNodeId ? [initiatingNodeId] : []) setNodeError(editor, nodeId, error)
		throw error
	} finally {
		activeRun.set(null)
	}
}
