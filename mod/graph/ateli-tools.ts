import { atom } from 'tldraw'

export type AteliValueType = 'mesh' | 'image' | 'text' | 'number' | 'boolean' | 'enum'
export type AteliCategory = 'Input' | 'Image' | 'Mesh'
export type AteliRuntime = 'none' | 'image' | 'imgen' | 'blender'

export interface AteliParam {
	id: string
	label: string
	type: AteliValueType
	required?: boolean
	default?: unknown
	options?: string[]
	min?: number
	max?: number
	step?: number
	multiline?: boolean
	advanced?: boolean
}

export interface AteliTool {
	id: string
	version: 1
	title: string
	category: AteliCategory
	runtime: AteliRuntime
	inputs: AteliParam[]
	outputs: AteliParam[]
}

// The bridge's `GET /ateli/tools` is the only catalog. The last good copy is kept in localStorage so an open
// document still renders its nodes when the bridge is down; unknown tools render as an empty card until it returns.
const storageKey = 'ateli.catalog.v1'
const toolsUrl = 'http://127.0.0.1:7237/ateli/tools'
const retryMs = 5000

function readStored(): AteliTool[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
		return Array.isArray(parsed) ? parsed as AteliTool[] : []
	} catch {
		return []
	}
}

export const catalog = atom<AteliTool[]>('ateli catalog', readStored())

export function getTool(toolId: string): AteliTool | undefined {
	return catalog.get().find(tool => tool.id === toolId)
}

// What a node shows for a tool the catalog does not know yet: its id as the title, no rows.
export function placeholderTool(toolId: string): AteliTool {
	return { id:toolId, version:1, title:toolId, category:'Input', runtime:'none', inputs:[], outputs:[] }
}

export function defaultValues(tool: AteliTool): Record<string, string | number | boolean> {
	return Object.fromEntries(tool.inputs.filter(input => input.default !== undefined).map(input => [input.id, input.default])) as Record<string, string | number | boolean>
}

let loading: Promise<void> | undefined
/** Fetch the catalog, retrying until the bridge answers. Safe to call repeatedly; one attempt runs at a time. */
export function loadCatalog(): Promise<void> {
	loading ??= (async () => {
		for (;;) {
			try {
				const response = await fetch(toolsUrl)
				if (!response.ok) throw new Error(`catalog ${response.status}`)
				const tools = await response.json() as AteliTool[]
				if (!Array.isArray(tools) || !tools.length) throw new Error('catalog empty')
				catalog.set(tools)
				localStorage.setItem(storageKey, JSON.stringify(tools))
				return
			} catch {
				const { promise, resolve } = Promise.withResolvers<void>()
				setTimeout(resolve, retryMs)
				await promise
			}
		}
	})().finally(() => { loading = undefined })
	return loading
}
