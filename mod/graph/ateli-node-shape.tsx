import { useEffect, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { Box, Boxes, ChevronRight, Download, FastForward, Maximize2, MoreHorizontal, Play, Trash2 } from 'lucide-react'
import {
	BaseBoxShapeTool,
	HTMLContainer,
	Polyline2d,
	Rectangle2d,
	Vec,
	ShapeUtil,
	T,
	createShapeId,
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	useEditor,
	useValue,
	type Editor,
	type JsonValue,
	type RecordProps,
	type TLBaseShape,
	type TLEventInfo,
	type TLShapeId,
} from 'tldraw'
import { cn } from '@/lib/utils'
import { activeRun, cancelAteliRun, client, runAteliGraph, type AteliRunScope } from './ateli-client'
import { catalog, defaultValues, getTool, placeholderTool, type AteliParam, type AteliValueType } from './ateli-tools'
import { openLightbox } from './lightbox'

export interface AteliNodeProps {
	w: number
	h: number
	toolId: string
	values: Record<string, JsonValue>
	results: Record<string, JsonValue>
	collapsed: boolean
}
export interface AteliEdgeProps { from: TLShapeId; fromPort: string; to: TLShapeId; toPort: string; valueType: AteliValueType }
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap { 'ateli-node': AteliNodeProps; 'ateli-edge': AteliEdgeProps }
}
export type AteliNodeShape = TLBaseShape<'ateli-node', AteliNodeProps>
export type AteliEdgeShape = TLBaseShape<'ateli-edge', AteliEdgeProps>

export const ateliNodeIcon = <Boxes size={24} aria-hidden />
const stop = (event: SyntheticEvent) => event.stopPropagation()

// Fixed canvas-unit geometry lets edge shapes recover exact port anchors from shape records.
const nodeWidth = 260
const headerHeight = 34
const rowHeight = 22
const padding = 10
const advancedToggleHeight = 22
const previewHeight = 126
const errorHeight = 34
const portColor: Record<AteliValueType, string> = {
	mesh:'#a78bfa', 'mesh[]':'#a78bfa',
	image:'#facc15', 'image[]':'#facc15',
	video:'#f472b6', 'video[]':'#f472b6',
	text:'#60a5fa', 'text[]':'#60a5fa',
	number:'#fb923c', 'number[]':'#fb923c',
	boolean:'#f87171', 'boolean[]':'#f87171',
	enum:'#fb923c',
}
type ListValueType = Extract<AteliValueType, `${string}[]`>
const isListType = (type: AteliValueType): type is ListValueType => type.endsWith('[]')
const baseType = (type: AteliValueType) => isListType(type) ? type.slice(0, -2) : type
const isFileType = (type: AteliValueType) => ['mesh', 'image', 'video'].includes(baseType(type))

interface StoredResultItem {
	resultId: string
	name?: string
	previewUrl?: string
	downloadUrl?: string
	value?: JsonValue
}
interface StoredSingleResult { resultId: string; previewUrl?: string; kind: string; value?: JsonValue }
interface StoredListResult { resultId: string; kind: string; items: Array<StoredResultItem | null> }
type StoredResult = StoredSingleResult | StoredListResult
function storedResultItem(value: JsonValue): StoredResultItem | null | undefined {
	if (value === null) return null
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
	const candidate = value as Record<string, JsonValue>
	// Scalar items (text[], number[]) carry a value and no preview.
	return typeof candidate.resultId === 'string' && (typeof candidate.previewUrl === 'string' || candidate.value !== undefined)
		? candidate as unknown as StoredResultItem
		: undefined
}
function storedResult(value: JsonValue | undefined): StoredResult | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
	const candidate = value as Record<string, JsonValue>
	if (typeof candidate.resultId !== 'string' || typeof candidate.kind !== 'string') return undefined
	if (Array.isArray(candidate.items)) {
		const items = candidate.items.map(storedResultItem)
		return items.every(item => item !== undefined)
			? { resultId:candidate.resultId, kind:candidate.kind, items:items as Array<StoredResultItem | null> }
			: undefined
	}
	return typeof candidate.previewUrl === 'string' || candidate.value !== undefined ? candidate as unknown as StoredSingleResult : undefined
}

function nodeError(shape: AteliNodeShape) {
	return typeof shape.props.results.error === 'string' ? shape.props.results.error : undefined
}

function rowsFor(shape: AteliNodeShape) {
	const tool = (getTool(shape.props.toolId) ?? placeholderTool(shape.props.toolId))
	const regularInputs = tool.inputs.filter(input => !input.advanced)
	const advancedInputs = tool.inputs.filter(input => input.advanced)
	const hasAdvanced = advancedInputs.length > 0
	const closedHeight = nodeHeight(shape, false)
	const openHeight = nodeHeight(shape, true)
	const advancedOpen = hasAdvanced && !shape.props.collapsed && Math.abs(shape.props.h - openHeight) < Math.abs(shape.props.h - closedHeight)
	return { tool, regularInputs, advancedInputs, advancedOpen, visibleInputs:advancedOpen ? [...regularInputs, ...advancedInputs] : regularInputs }
}

function nodeHeight(shape: AteliNodeShape, advancedOpen: boolean) {
	if (shape.props.collapsed) return headerHeight
	const tool = (getTool(shape.props.toolId) ?? placeholderTool(shape.props.toolId))
	const regularCount = tool.inputs.filter(input => !input.advanced).length
	const advancedCount = advancedOpen ? tool.inputs.filter(input => input.advanced).length : 0
	const toggle = tool.inputs.some(input => input.advanced) ? advancedToggleHeight : 0
	const error = nodeError(shape) ? errorHeight : 0
	return headerHeight + padding + (regularCount + advancedCount + tool.outputs.length) * rowHeight + toggle + padding + previewHeight + padding + error
}

function portLocalPoint(shape: AteliNodeShape, portId: string, side: 'input' | 'output') {
	const { tool, regularInputs, advancedInputs, advancedOpen } = rowsFor(shape)
	const regularIndex = side === 'input' ? regularInputs.findIndex(port => port.id === portId) : -1
	const advancedIndex = side === 'input' ? advancedInputs.findIndex(port => port.id === portId) : -1
	const outputIndex = side === 'output' ? tool.outputs.findIndex(port => port.id === portId) : -1
	if (regularIndex < 0 && advancedIndex < 0 && outputIndex < 0) return undefined
	if (shape.props.collapsed) return { x:outputIndex >= 0 ? shape.props.w : 0, y:headerHeight / 2 }
	if (regularIndex >= 0) return { x:0, y:headerHeight + padding + regularIndex * rowHeight + rowHeight / 2 }
	const toggleTop = headerHeight + padding + regularInputs.length * rowHeight
	if (advancedIndex >= 0) {
		return { x:0, y:advancedOpen ? toggleTop + advancedToggleHeight + advancedIndex * rowHeight + rowHeight / 2 : toggleTop + advancedToggleHeight / 2 }
	}
	const outputTop = toggleTop + (advancedInputs.length ? advancedToggleHeight : 0) + (advancedOpen ? advancedInputs.length * rowHeight : 0)
	return { x:shape.props.w, y:outputTop + outputIndex * rowHeight + rowHeight / 2 }
}

export function portPagePoint(editor: Editor, shape: AteliNodeShape, portId: string, side: 'input' | 'output') {
	const local = portLocalPoint(shape, portId, side)
	return local ? editor.getShapePageTransform(shape).applyToPoint(local) : undefined
}

const edgesOf = (editor: Editor) => editor.getCurrentPageShapes().filter((shape): shape is AteliEdgeShape => shape.type === 'ateli-edge')

function wouldCycle(editor: Editor, from: TLShapeId, to: TLShapeId, ignoredEdgeId?: TLShapeId) {
	const next = new Map<TLShapeId, TLShapeId[]>()
	for (const edge of edgesOf(editor)) {
		if (edge.id === ignoredEdgeId) continue
		next.set(edge.props.from, [...(next.get(edge.props.from) ?? []), edge.props.to])
	}
	const stack = [to]
	const seen = new Set<TLShapeId>()
	while (stack.length) {
		const id = stack.pop()!
		if (id === from) return true
		if (seen.has(id)) continue
		seen.add(id)
		stack.push(...(next.get(id) ?? []))
	}
	return false
}

interface EdgeSource { shapeId: TLShapeId; port: AteliParam }
function canConnect(editor: Editor, source: EdgeSource, targetNodeId: TLShapeId, target: AteliParam, ignoredEdgeId?: TLShapeId) {
	return source.shapeId !== targetNodeId && baseType(source.port.type) === baseType(target.type) && !wouldCycle(editor, source.shapeId, targetNodeId, ignoredEdgeId)
}

export function connectPorts(editor: Editor, source: EdgeSource, to: TLShapeId, target: AteliParam, rewiredEdgeId?: TLShapeId) {
	if (!canConnect(editor, source, to, target, rewiredEdgeId)) return false
	const occupied = (getTool(editor.getShape<AteliNodeShape>(to)?.props.toolId ?? '')?.id.startsWith('list.collect') ?? false)
		? undefined
		: edgesOf(editor).find(edge => edge.id !== rewiredEdgeId && edge.props.to === to && edge.props.toPort === target.id)
	editor.markHistoryStoppingPoint('Connect Ateli ports')
	const replaced = [rewiredEdgeId, occupied?.id].filter((id): id is TLShapeId => Boolean(id))
	console.info('[ateli] connect', `${source.shapeId}.${source.port.id} → ${to}.${target.id}`, replaced.length ? `(replaced ${replaced.join(', ')})` : '')
	if (replaced.length) editor.deleteShapes(replaced)
	const id = createShapeId()
	editor.createShape<AteliEdgeShape>({ id, type:'ateli-edge', x:0, y:0, props:{ from:source.shapeId, fromPort:source.port.id, to, toPort:target.id, valueType:source.port.type } })
	editor.sendToBack([id])
	return true
}

interface DragState { source: EdgeSource; point: { x: number; y: number }; edgeId?: TLShapeId }
interface DragChannel {
	state?: DragState
	listeners: Set<() => void>
	set(next: DragState | undefined): void
}
const dragChannels = new WeakMap<Editor, DragChannel>()

function nearestOutput(editor: Editor, shape: AteliNodeShape, point: { x: number; y: number }) {
	const tool = getTool(shape.props.toolId)
	if (!tool || shape.props.collapsed) return undefined
	const radius = 14 / editor.getZoomLevel()
	return tool.outputs.find(port => {
		const anchor = portPagePoint(editor, shape, port.id, 'output')
		return anchor && Math.hypot(anchor.x - point.x, anchor.y - point.y) <= radius
	})
}

function nearestInput(editor: Editor, state: DragState, point: { x: number; y: number }) {
	const radius = 14 / editor.getZoomLevel()
	let nearest: { node: AteliNodeShape; port: AteliParam; distance: number } | undefined
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'ateli-node' || shape.props.collapsed) continue
		const { visibleInputs } = rowsFor(shape)
		for (const port of visibleInputs) {
			const anchor = portPagePoint(editor, shape, port.id, 'input')
			if (!anchor) continue
			const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y)
			if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { node:shape, port, distance }
		}
	}
	return nearest && canConnect(editor, state.source, nearest.node.id, nearest.port, state.edgeId) ? nearest : undefined
}

function sourceForEdge(editor: Editor, edge: AteliEdgeShape): EdgeSource | undefined {
	const node = editor.getShape<AteliNodeShape>(edge.props.from)
	const port = node && getTool(node.props.toolId)?.outputs.find(output => output.id === edge.props.fromPort)
	return node && port ? { shapeId:node.id, port } : undefined
}

function finishDrag(editor: Editor, channel: DragChannel, point: { x: number; y: number }) {
	const state = channel.state
	if (!state) return
	const target = nearestInput(editor, state, point)
	channel.set(undefined)
	if (target) connectPorts(editor, state.source, target.node.id, target.port, state.edgeId)
	else if (state.edgeId && editor.getShape(state.edgeId)) {
		editor.markHistoryStoppingPoint('Detach Ateli edge')
		console.info('[ateli] detach', state.edgeId, 'dropped on empty canvas')
		editor.deleteShape(state.edgeId)
	} else console.info('[ateli] drag ended with no target', state.edgeId ? `(edge ${state.edgeId} kept)` : '')
}

function beginDrag(editor: Editor, source: EdgeSource, point: { x: number; y: number }, edgeId?: TLShapeId) {
	const channel = dragChannel(editor)
	channel.set({ source, point, edgeId })
}

function handleEditorEvent(editor: Editor, channel: DragChannel, info: TLEventInfo) {
	if (info.type !== 'pointer') return
	const point = editor.inputs.currentPagePoint
	if (info.name === 'pointer_down' && !channel.state && info.target === 'shape') {
		if (info.shape.type === 'ateli-node') {
			const port = nearestOutput(editor, info.shape as AteliNodeShape, point)
			if (port) beginDrag(editor, { shapeId:info.shape.id, port }, point)
		} else if (info.shape.type === 'ateli-edge') {
			const edge = info.shape as AteliEdgeShape
			const target = editor.getShape<AteliNodeShape>(edge.props.to)
			const end = target && portPagePoint(editor, target, edge.props.toPort, 'input')
			const source = sourceForEdge(editor, edge)
			if (end && source && Math.hypot(end.x - point.x, end.y - point.y) <= 14 / editor.getZoomLevel()) beginDrag(editor, source, point, edge.id)
		}
	} else if (info.name === 'pointer_move' && channel.state) {
		channel.set({ ...channel.state, point:{ x:point.x, y:point.y } })
	} else if (info.name === 'pointer_up' && channel.state) {
		finishDrag(editor, channel, point)
	}
}

function dragChannel(editor: Editor) {
	let channel = dragChannels.get(editor)
	if (channel) return channel
	channel = {
		listeners:new Set(),
		set(next) {
			this.state = next
			for (const listener of this.listeners) listener()
		},
	}
	dragChannels.set(editor, channel)
	const onEvent = (info: TLEventInfo) => handleEditorEvent(editor, channel!, info)
	const events = editor as Editor & {
		on(event: 'event', listener: (info: TLEventInfo) => void): void
		once(event: 'dispose', listener: () => void): void
		off(event: 'event', listener: (info: TLEventInfo) => void): void
	}
	events.on('event', onEvent)
	events.once('dispose', () => events.off('event', onEvent))
	return channel
}

function useDrag(editor: Editor) {
	const channel = dragChannel(editor)
	const [state, setState] = useState(channel.state)
	useEffect(() => {
		const listener = () => setState(channel.state)
		channel.listeners.add(listener)
		return () => { channel.listeners.delete(listener) }
	}, [channel])
	return state
}

function beginDomDrag(editor: Editor, source: EdgeSource, event: ReactPointerEvent, edgeId?: TLShapeId) {
	event.preventDefault()
	event.stopPropagation()
	beginDrag(editor, source, editor.screenToPage({ x:event.clientX, y:event.clientY }), edgeId)
	const move = (next: PointerEvent) => {
		const channel = dragChannel(editor)
		if (channel.state) channel.set({ ...channel.state, point:editor.screenToPage({ x:next.clientX, y:next.clientY }) })
	}
	const up = (next: PointerEvent) => {
		window.removeEventListener('pointermove', move)
		window.removeEventListener('pointerup', up)
		window.removeEventListener('pointercancel', cancel)
		finishDrag(editor, dragChannel(editor), editor.screenToPage({ x:next.clientX, y:next.clientY }))
	}
	const cancel = () => {
		window.removeEventListener('pointermove', move)
		window.removeEventListener('pointerup', up)
		window.removeEventListener('pointercancel', cancel)
		const channel = dragChannel(editor)
		if (channel.state?.edgeId && editor.getShape(channel.state.edgeId)) editor.deleteShape(channel.state.edgeId)
		channel.set(undefined)
	}
	window.addEventListener('pointermove', move)
	window.addEventListener('pointerup', up)
	window.addEventListener('pointercancel', cancel)
}

export function AteliEdgeOverlay() {
	const editor = useEditor()
	const state = useDrag(editor)
	if (!state) return null
	const sourceNode = editor.getShape<AteliNodeShape>(state.source.shapeId)
	const startPage = sourceNode && portPagePoint(editor, sourceNode, state.source.port.id, 'output')
	if (!startPage) return null
	const start = editor.pageToViewport(startPage)
	const end = editor.pageToViewport(state.point)
	return (
		<svg className="pointer-events-none absolute inset-0 size-full overflow-visible" style={{ zIndex:300 }} aria-hidden>
			<path d={edgePath(start, end)} fill="none" stroke={portColor[state.source.port.type]} strokeWidth={2} strokeLinecap="round" />
		</svg>
	)
}

function connectedInputValue(editor: Editor, nodeId: TLShapeId, portId: string) {
	const edge = edgesOf(editor).find(candidate => candidate.props.to === nodeId && candidate.props.toPort === portId)
	if (!edge) return { connected:false as const, value:undefined }
	const source = editor.getShape<AteliNodeShape>(edge.props.from)
	const result = source && storedResult(source.props.results[edge.props.fromPort])
	return { connected:true as const, value:result && !('items' in result) ? result.value : undefined }
}

// A node's fan-out width: a list result (or an Input's file count) on any single-typed input, propagated through
// upstream nodes that are themselves fanned out. Visited ids guard against cycles the bridge would reject anyway.
function fanOutCardinality(editor: Editor, shape: AteliNodeShape, visited = new Set<TLShapeId>()): number {
	const tool = getTool(shape.props.toolId)
	if (!tool || visited.has(shape.id)) return 1
	visited.add(shape.id)
	let cardinality = 1
	for (const input of tool.inputs) {
		if (isListType(input.type)) continue
		const edge = edgesOf(editor).find(candidate => candidate.props.to === shape.id && candidate.props.toPort === input.id)
		if (!edge) continue
		const source = editor.getShape<AteliNodeShape>(edge.props.from)
		if (!source) continue
		const result = storedResult(source.props.results[edge.props.fromPort])
		if (result && 'items' in result) {
			cardinality = Math.max(cardinality, result.items.length)
			continue
		}
		if (source.props.toolId === 'input.meshes' || source.props.toolId === 'input.images') {
			const files = source.props.values.files
			if (Array.isArray(files)) cardinality = Math.max(cardinality, files.length)
			continue
		}
		const sourcePort = getTool(source.props.toolId)?.outputs.find(output => output.id === edge.props.fromPort)
		if (sourcePort && !isListType(sourcePort.type)) cardinality = Math.max(cardinality, fanOutCardinality(editor, source, visited))
	}
	return cardinality
}


function InputControl({ shape, editor, param, readonly, onValues }: { shape: AteliNodeShape; editor: Editor; param: AteliParam; readonly: boolean; onValues(patch: Record<string, JsonValue>): void }) {
	const upstream = connectedInputValue(editor, shape.id, param.id)
	const disabled = readonly || upstream.connected
	const raw = upstream.connected ? upstream.value : shape.props.values[param.id] ?? param.default
	const value = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : ''
	const shared = {
		disabled,
		className:'ui-well pointer-events-auto h-[18px] min-w-0 flex-1 rounded border-0 px-1.5 text-[10px] text-foreground outline-none disabled:opacity-70',
		onPointerDown:stop,
		onKeyDown:stop,
	}
	if (param.type === 'boolean') {
		return <select {...shared} value={String(value === '' ? false : value)} onChange={event => onValues({ [param.id]:event.currentTarget.value === 'true' })}><option value="true">true</option><option value="false">false</option></select>
	}
	if (param.type === 'enum') {
		return <select {...shared} value={String(value)} onChange={event => onValues({ [param.id]:event.currentTarget.value })}>{upstream.connected && value === '' ? <option value="">Connected</option> : null}{param.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>
	}
	return <input {...shared} type={param.type === 'number' ? 'number' : 'text'} value={String(value)} placeholder={upstream.connected ? 'Connected' : ''} min={param.min} max={param.max} step={param.step} onChange={event => onValues({ [param.id]:param.type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value })} />
}

function InputRow({ shape, editor, param, readonly, drag, onValues, onUpload }: { shape: AteliNodeShape; editor: Editor; param: AteliParam; readonly: boolean; drag?: DragState; onValues(patch: Record<string, JsonValue>): void; onUpload(files: File[], param: AteliParam): void }) {
	const compatible = drag ? canConnect(editor, drag.source, shape.id, param, drag.edgeId) : false
	const dim = Boolean(drag) && !compatible
	const multiFile = (shape.props.toolId === 'input.meshes' || shape.props.toolId === 'input.images') && param.id === 'files'
	const singleFile = (shape.props.toolId === 'input.image' || shape.props.toolId === 'input.mesh' || shape.props.toolId === 'input.video') && param.id === 'file'
	const fileInput = singleFile || multiFile
	const storedFiles = shape.props.values[param.id]
	const fileCount = Array.isArray(storedFiles) ? storedFiles.length : 0
	const connectedEdge = edgesOf(editor).find(edge => edge.props.to === shape.id && edge.props.toPort === param.id)
	const color = portColor[param.type]
	const listPort = isListType(param.type)
	return (
		<div data-ateli-port="input" data-node-id={shape.id} data-port-id={param.id} className={cn('flex h-[22px] items-center gap-2 px-2.5 text-[11px] text-foreground', dim && 'opacity-30')}>
			<button
				type="button"
				aria-label={connectedEdge ? `Detach ${param.label} input` : `${param.label} input`}
				className={cn('pointer-events-auto relative -ml-[14px] size-2 shrink-0 rounded-full p-0', connectedEdge ? 'cursor-grab' : 'cursor-default')}
				style={{ background:listPort ? 'transparent' : color, border:listPort ? `1px solid ${color}` : 0, boxShadow:compatible ? `0 0 0 3px ${color}66` : undefined }}
				disabled={readonly || !connectedEdge}
				onPointerDown={event => { const source = connectedEdge && sourceForEdge(editor, connectedEdge); if (source) beginDomDrag(editor, source, event, connectedEdge.id) }}
			>
				{listPort ? <span className="absolute inset-[2px] rounded-full border" style={{ borderColor:color }} /> : null}
			</button>
			<span className="w-[72px] shrink-0 truncate">{param.label}</span>
			{fileInput ? (
				<div className={cn('ui-well pointer-events-auto flex h-[18px] min-w-0 flex-1 items-center rounded text-[10px] text-muted-foreground', readonly && 'pointer-events-none opacity-50')} onPointerDown={stop}>
					<label className="flex min-w-0 flex-1 cursor-pointer items-center truncate px-1.5">
						{multiFile ? (fileCount ? `${fileCount} files` : 'Choose files') : (typeof storedFiles === 'string' ? 'Replace file' : 'Choose file')}
						<input type="file" className="hidden" accept={baseType(param.type) === 'mesh' ? '.glb,.gltf' : baseType(param.type) === 'video' ? 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov' : 'image/*'} multiple={multiFile} disabled={readonly} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) onUpload(files, param) }} />
					</label>
					{multiFile && fileCount ? <button type="button" className="h-full shrink-0 border-0 bg-transparent px-1.5 text-xs leading-none text-muted-foreground" title="Clear files" aria-label="Clear files" onPointerDown={stop} onClick={event => { stop(event); onValues({ [param.id]:[] }) }}>×</button> : null}
				</div>
			) : isFileType(param.type) ? <span className="flex-1" /> : <InputControl shape={shape} editor={editor} param={param} readonly={readonly} onValues={onValues} />}
		</div>
	)
}

function OutputRow({ shape, editor, port, readonly, active }: { shape: AteliNodeShape; editor: Editor; port: AteliParam; readonly: boolean; active: boolean }) {
	const color = portColor[port.type]
	const listPort = isListType(port.type)
	return (
		<div data-ateli-port="output" data-node-id={shape.id} data-port-id={port.id} className="flex h-[22px] flex-row-reverse items-center gap-2 px-2.5 text-right text-[11px] text-foreground">
			<button type="button" aria-label={`Drag ${port.label} output`} className="pointer-events-auto relative -mr-[14px] size-2 shrink-0 cursor-crosshair rounded-full p-0" disabled={readonly} style={{ background:listPort ? 'transparent' : color, border:listPort ? `1px solid ${color}` : 0, boxShadow:active ? `0 0 0 3px ${color}66` : undefined }} onPointerDown={event => beginDomDrag(editor, { shapeId:shape.id, port }, event)}>
				{listPort ? <span className="absolute inset-[2px] rounded-full border" style={{ borderColor:color }} /> : null}
			</button>
			<span className="truncate">{port.label}</span>
		</div>
	)
}

function Preview({ shape, editor }: { shape: AteliNodeShape; editor: Editor }) {
	const { toolId, results } = shape.props
	const tool = (getTool(toolId) ?? placeholderTool(toolId))
	const resolved = tool.outputs.flatMap(output => {
		const result = storedResult(results[output.id])
		return result ? [{ output, result }] : []
	})
	let visualResults = resolved.filter(({ result }) => ['mesh', 'image', 'video', 'mesh[]', 'image[]', 'video[]'].includes(result.kind))
	// A node that only passes a file through (Export) shows what it exported: the connected upstream result.
	if (!visualResults.length && resolved.length) {
		for (const input of tool.inputs) {
			if (!isFileType(input.type)) continue
			const edge = edgesOf(editor).find(candidate => candidate.props.to === shape.id && candidate.props.toPort === input.id)
			const upstream = edge && editor.getShape<AteliNodeShape>(edge.props.from)
			const result = upstream && storedResult(upstream.props.results[edge.props.fromPort])
			if (result && ['mesh', 'image', 'video', 'mesh[]', 'image[]', 'video[]'].includes(result.kind)) {
				visualResults = [{ output:input, result }]
				break
			}
		}
	}
	const filmstrip = visualResults.some(({ result }) => 'items' in result)
	const visual: Array<{
		key: string
		label: string
		kind: 'mesh' | 'image' | 'video'
		result?: StoredSingleResult | StoredResultItem
		previewUrl?: string
	}> = []
	for (const { output, result } of visualResults) {
		if ('items' in result) {
			const kind = result.kind.slice(0, -2) as 'mesh' | 'image' | 'video'
			for (const [index, item] of result.items.entries()) {
				visual.push({
					key:`${output.id}:${index}`,
					label:`${output.label} ${index + 1}`,
					kind,
					result:item ?? undefined,
					previewUrl:item?.previewUrl,
				})
			}
			continue
		}
		visual.push({
			key:output.id,
			label:output.label,
			kind:result.kind as 'mesh' | 'image' | 'video',
			result,
			previewUrl:result.previewUrl,
		})
	}
	async function show(label: string, kind: 'mesh' | 'image' | 'video', result: StoredSingleResult | StoredResultItem) {
		const loaded = await client.result(result.resultId)
		if ('items' in loaded) throw new Error('Expected a single result')
		openLightbox({
			title:`${tool.title} · ${label}${'name' in result ? ` · ${result.name}` : ''}`,
			kind,
			previewUrl:loaded.previewUrl,
			downloadUrl:loaded.downloadUrl,
		})
	}
	// Save through the native dialog so the user picks the folder; fall back to a download link where the
	// File System Access API is unavailable. The Export node remains the way to record provenance.
	async function save(result: StoredSingleResult | StoredResultItem) {
		const loaded = await client.result(result.resultId)
		if ('items' in loaded) throw new Error('Expected a single result')
		const response = await fetch(loaded.downloadUrl)
		if (!response.ok) throw new Error(`download failed (${response.status})`)
		const blob = await response.blob()
		const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName?: string }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker
		if (picker) {
			const handle = await picker({ suggestedName:loaded.name }).catch(() => undefined)
			if (!handle) return
			const writable = await handle.createWritable()
			await writable.write(blob)
			await writable.close()
			return
		}
		const url = URL.createObjectURL(blob)
		const anchor = Object.assign(document.createElement('a'), { href:url, download:loaded.name })
		anchor.click()
		URL.revokeObjectURL(url)
	}
	const clear = () => editor.updateShape<AteliNodeShape>({ id:shape.id, type:'ateli-node', props:{ results:{} } })
	const report = (error: unknown) => console.error('[ateli] preview action failed', error)
	if (visual.length && filmstrip) {
		return (
			<div data-ateli-filmstrip className="ui-well flex h-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1">
				{visual.map(item => (
					<div key={item.key} className="group relative h-full w-[72px] shrink-0 overflow-hidden rounded">
						{item.result && item.previewUrl ? (
							<>
								<button type="button" data-ateli-preview={item.key} className="pointer-events-auto size-full cursor-zoom-in overflow-hidden rounded border-0 bg-transparent p-0" aria-label={`Open ${item.label} preview`} onPointerDown={stop} onClick={event => { stop(event); void show(item.label, item.kind, item.result!).catch(report) }}>
									<img src={item.previewUrl} alt={`${item.label} preview`} className="size-full object-contain" />
								</button>
								<div className="pointer-events-auto absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onPointerDown={stop}>
									<button type="button" className="ui-key ui-icon-button size-5" title="Expand" aria-label={`Expand ${item.label} preview`} onClick={event => { stop(event); void show(item.label, item.kind, item.result!).catch(report) }}><Maximize2 size={10} /></button>
									<button type="button" className="ui-key ui-icon-button size-5" title="Save file…" aria-label={`Save ${item.label}`} onClick={event => { stop(event); void save(item.result!).catch(report) }}><Download size={10} /></button>
									<button type="button" className="ui-key ui-icon-button size-5" title="Clear results" aria-label="Clear results" onClick={event => { stop(event); clear() }}><Trash2 size={10} /></button>
								</div>
							</>
						) : <div className="grid size-full place-items-center text-[10px] text-muted-foreground">failed</div>}
					</div>
				))}
			</div>
		)
	}
	if (visual.length) {
		const primary = visual[0]!
		return (
			<div className="group ui-well relative flex h-full items-center gap-1 overflow-hidden rounded-lg p-1">
				{visual.map(item => item.result && item.previewUrl ? (
					<button key={item.key} type="button" data-ateli-preview={item.key} className="pointer-events-auto h-full min-w-0 flex-1 cursor-zoom-in overflow-hidden rounded border-0 bg-transparent p-0" aria-label={`Open ${item.label} preview`} onPointerDown={stop} onClick={event => { stop(event); void show(item.label, item.kind, item.result!).catch(report) }}>
						<img src={item.previewUrl} alt={`${item.label} preview`} className="size-full object-contain" />
					</button>
				) : null)}
				{primary.result ? <div className="pointer-events-auto absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100" onPointerDown={stop}>
					<button type="button" className="ui-key ui-icon-button size-7" title="Expand" aria-label="Expand preview" onClick={event => { stop(event); void show(primary.label, primary.kind, primary.result!).catch(report) }}><Maximize2 size={13} /></button>
					<button type="button" className="ui-key ui-icon-button size-7" title="Save file…" aria-label="Save file" onClick={event => { stop(event); void save(primary.result!).catch(report) }}><Download size={13} /></button>
					<button type="button" className="ui-key ui-icon-button size-7" title="Clear results" aria-label="Clear results" onClick={event => { stop(event); clear() }}><Trash2 size={13} /></button>
				</div> : null}
			</div>
		)
	}
	const scalar = resolved.find(({ result }) => !('items' in result) && result.value !== undefined)
	if (scalar && !('items' in scalar.result)) return <div className="ui-well grid h-full place-items-center overflow-auto rounded-lg px-3 text-center text-xs text-foreground">{String(scalar.result.value)}</div>
	const list = resolved.find(({ result }) => 'items' in result)
	if (list && 'items' in list.result) return <div className="ui-well grid h-full place-items-center rounded-lg text-xs text-foreground">{list.result.items.length} items</div>
	return <div className="ui-well grid h-full place-items-center rounded-lg text-muted-foreground"><div className="grid place-items-center gap-1"><Box size={28} strokeWidth={1.25} aria-hidden /><span className="ui-label">Preview</span></div></div>
}

function NodeMenu({ shape, editor, update, busy }: { shape: AteliNodeShape; editor: Editor; update(patch: Partial<AteliNodeProps>): void; busy: boolean }) {
	const close = (event: SyntheticEvent) => {
		stop(event)
		const details = event.currentTarget.closest('details')
		if (details) details.open = false
	}
	const fail = (error: unknown) => update({ results:{ ...shape.props.results, error:error instanceof Error ? error.message : String(error) } })
	return (
		<details className="pointer-events-auto relative" onPointerDown={stop}>
			<summary className="ui-icon-button size-6 list-none" aria-label="Node menu"><MoreHorizontal size={15} /></summary>
			<div className="ui-panel absolute top-7 right-0 z-10 grid w-32 gap-0.5 p-1 text-[11px]">
				{busy ? <button className="ui-option h-7 border-0 bg-transparent px-2" type="button" onClick={event => { close(event); void cancelAteliRun() }}>Cancel run</button> : null}
				<button className="ui-option h-7 border-0 bg-transparent px-2" type="button" onClick={event => { close(event); update({ results:{} }) }}>Clear results</button>
				<button className="ui-option h-7 border-0 bg-transparent px-2" type="button" onClick={event => { close(event); void client.clearCache(shape.id).catch(fail) }}>Clear cache</button>
				<button className="ui-option h-7 border-0 bg-transparent px-2" type="button" onClick={event => { close(event); const collapsed = !shape.props.collapsed; update({ collapsed, h:collapsed ? headerHeight : nodeHeight({ ...shape, props:{ ...shape.props, collapsed:false } }, false) }) }}>{shape.props.collapsed ? 'Expand' : 'Collapse'}</button>
			</div>
		</details>
	)
}
function AteliNodeView({ shape, editor }: { shape: AteliNodeShape; editor: Editor }) {
	// Rows come from the bridge catalog; re-render (and re-measure) when it loads or changes.
	useValue(catalog)
	const { tool, regularInputs, advancedInputs, advancedOpen } = rowsFor(shape)
	const readonly = useValue('ateli readonly', () => editor.getIsReadonly() || editor.isShapeOrAncestorLocked(shape.id), [editor, shape.id])
	const cardinality = useValue('ateli cardinality', () => fanOutCardinality(editor, shape), [editor, shape.id, shape.props.toolId])
	const drag = useDrag(editor)
	const [uploading, setUploading] = useState(false)
	const update = (patch: Partial<AteliNodeProps>) => editor.updateShape<AteliNodeShape>({ id:shape.id, type:'ateli-node', props:patch })
	const setValues = (patch: Record<string, JsonValue>) => update({ values:{ ...shape.props.values, ...patch } })
	const run = (scope: AteliRunScope) => { void runAteliGraph(editor, scope).catch(() => undefined) }
	const error = nodeError(shape)
	// Run state is session-only (see ateli-client): one run per editor, and nothing persisted as "running".
	const live = useValue(activeRun)
	const busy = live !== null
	const liveNode = live?.nodes[shape.id]
	const running = liveNode?.status === 'running' || liveNode?.status === 'queued'
	const batch = liveNode?.items
	const badge = batch ? `${batch.done}/${batch.total}` : cardinality > 1 ? `×${cardinality}` : undefined
	useEffect(() => {
		const expected = nodeHeight(shape, advancedOpen)
		if (shape.props.h !== expected) update({ h:expected })
	}, [advancedOpen, error, shape.props.collapsed, shape.props.h])
	async function upload(files: File[], param: AteliParam) {
		setUploading(true)
		try {
			const sourceIds: string[] = []
			for (const file of files) {
				const source = await client.uploadSource(file)
				sourceIds.push(source.sourceId)
			}
			setValues({ [param.id]:isListType(param.type) ? sourceIds : sourceIds[0]! })
		} catch (uploadError) {
			update({ results:{ ...shape.props.results, error:uploadError instanceof Error ? uploadError.message : String(uploadError) } })
		} finally {
			setUploading(false)
		}
	}
	return (
		<HTMLContainer className="ui-panel overflow-visible font-sans antialiased" style={{ width:shape.props.w, height:shape.props.h }}>
			<div className="ui-rule-bottom flex items-center gap-1 px-3 text-xs font-medium text-foreground" style={{ height:headerHeight }}>
				<span className="min-w-0 flex-1 truncate">{tool.title}</span>
				{badge ? <span data-ateli-cardinality={cardinality} data-ateli-progress={batch ? `${batch.done}/${batch.total}` : undefined} className="ui-label shrink-0">{badge}</span> : null}
				{uploading ? <span className="ui-label">Uploading</span> : null}
				<NodeMenu shape={shape} editor={editor} update={update} busy={busy} />
				<button type="button" className="ui-icon-button pointer-events-auto size-6" title="Run node" aria-label="Run node" disabled={readonly || busy} onPointerDown={stop} onClick={event => { stop(event); run({ kind:'node', nodeId:shape.id }) }}><Play size={13} fill="currentColor" /></button>
				<button type="button" className="ui-icon-button pointer-events-auto size-6" title="Run downstream" aria-label="Run downstream" disabled={readonly || busy} onPointerDown={stop} onClick={event => { stop(event); run({ kind:'downstream', nodeId:shape.id }) }}><FastForward size={14} fill="currentColor" /></button>
			</div>
			{running ? <div className="absolute inset-x-0 h-0.5 overflow-hidden" style={{ top:headerHeight - 2 }}><div className={cn('h-full bg-blue-400', !batch && 'w-2/5 animate-[shimmer_1.4s_ease-in-out_infinite]')} style={batch ? { width:`${batch.total ? Math.min(100, batch.done / batch.total * 100) : 0}%` } : undefined} /></div> : null}
			{shape.props.collapsed ? null : (
				<>
					<div style={{ paddingTop:padding }}>
						{regularInputs.map(param => <InputRow key={param.id} shape={shape} editor={editor} param={param} readonly={readonly} drag={drag} onValues={setValues} onUpload={upload} />)}
						{advancedInputs.length ? (
							<button type="button" className="pointer-events-auto flex w-full items-center gap-1 border-0 bg-transparent px-2.5 text-left text-[10px] text-muted-foreground" style={{ height:advancedToggleHeight }} onPointerDown={stop} onClick={event => { stop(event); update({ h:nodeHeight(shape, !advancedOpen) }) }}>
								Advanced {advancedInputs.length}<ChevronRight size={11} className={cn('transition-transform', advancedOpen && 'rotate-90')} />
							</button>
						) : null}
						{advancedOpen ? advancedInputs.map(param => <InputRow key={param.id} shape={shape} editor={editor} param={param} readonly={readonly} drag={drag} onValues={setValues} onUpload={upload} />) : null}
						{tool.outputs.map(port => <OutputRow key={port.id} shape={shape} editor={editor} port={port} readonly={readonly} active={drag?.source.shapeId === shape.id && drag.source.port.id === port.id} />)}
					</div>
					<div className="px-2.5" style={{ height:previewHeight, paddingTop:padding }}><Preview shape={shape} editor={editor} /></div>
					{error ? <div className="overflow-hidden px-2.5 pt-2 text-[10px] leading-3" style={{ height:errorHeight, color:'#f87171' }}>{error}</div> : null}
				</>
			)}
		</HTMLContainer>
	)
}

// Edges are store-owned dependents: deleting a node removes every attached edge.
const cleanupRegistered = new WeakSet<Editor>()
function registerEdgeCleanup(editor: Editor) {
	if (cleanupRegistered.has(editor)) return
	cleanupRegistered.add(editor)
	editor.sideEffects.registerBeforeDeleteHandler('shape', record => {
		if (record.type !== 'ateli-node') return
		const attached = edgesOf(editor).filter(edge => edge.props.from === record.id || edge.props.to === record.id)
		if (attached.length) editor.deleteShapes(attached.map(edge => edge.id))
	})
}

const nodeMigrationIds = createShapePropsMigrationIds('ateli-node', { slots:1, values:2 })
const legacyToolIds: Record<string, string> = {
	'asset.upload':'input.mesh', 'materials.break':'mesh.extractTextures', 'mesh.decimate':'mesh.optimize', 'asset.recombine':'mesh.applyTextures',
}

export class AteliNodeShapeUtil extends ShapeUtil<AteliNodeShape> {
	static override type = 'ateli-node' as const
	static override props: RecordProps<AteliNodeShape> = { w:T.number, h:T.number, toolId:T.string, values:T.jsonDict(), results:T.jsonDict(), collapsed:T.boolean }
	static override migrations = createShapePropsMigrationSequence({ sequence:[
		{
			id:nodeMigrationIds.slots,
			up(props: Record<string, unknown>) {
				delete props.title; delete props.category; delete props.inputs; delete props.outputs; delete props.status
				if (typeof props.slots !== 'string') props.slots = '[]'
				if (typeof props.parameters !== 'string') props.parameters = '{}'
			},
			down(props: Record<string, unknown>) { delete props.slots },
		},
		{
			id:nodeMigrationIds.values,
			up(props: Record<string, unknown>) {
				const toolId = typeof props.toolId === 'string' ? legacyToolIds[props.toolId] ?? props.toolId : 'input.mesh'
				const tool = (getTool(toolId) ?? placeholderTool(toolId))
				let legacy: Record<string, unknown> = {}
				if (typeof props.parameters === 'string') {
					try { legacy = JSON.parse(props.parameters) as Record<string, unknown> } catch { legacy = {} }
				} else if (props.parameters && typeof props.parameters === 'object') legacy = props.parameters as Record<string, unknown>
				const values: Record<string, JsonValue> = { ...defaultValues(tool) }
				for (const input of tool.inputs) {
					const value = legacy[input.id]
					if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) values[input.id] = value
				}
				props.toolId = tool.id; props.values = values; props.results = {}; props.collapsed = false
				delete props.slots; delete props.parameters
			},
			down(props: Record<string, unknown>) {
				props.slots = '[]'; props.parameters = JSON.stringify(props.values ?? {})
				delete props.values; delete props.results; delete props.collapsed
			},
		},
	] })
	getDefaultProps(): AteliNodeProps { return nodeProps('input.mesh') }
	override canResize() { return false }
	override hideRotateHandle() { return true }
	override getAriaDescriptor(shape: AteliNodeShape) { return `${getTool(shape.props.toolId)?.title ?? 'Ateli'} node` }
	getGeometry(shape: AteliNodeShape) { return new Rectangle2d({ width:shape.props.w, height:shape.props.h, isFilled:true }) }
	component(shape: AteliNodeShape) { registerEdgeCleanup(this.editor); dragChannel(this.editor); return <AteliNodeView shape={shape} editor={this.editor} /> }
	override getIndicatorPath(shape: AteliNodeShape) { const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 10); return path }
}

export class AteliNodeShapeTool extends BaseBoxShapeTool {
	static override id = 'ateli-node'
	static override initial = 'idle'
	override shapeType = 'ateli-node' as const
}

function edgePoints(editor: Editor, edge: AteliEdgeShape) {
	const from = editor.getShape<AteliNodeShape>(edge.props.from)
	const to = editor.getShape<AteliNodeShape>(edge.props.to)
	if (!from || !to) return undefined
	const start = portPagePoint(editor, from, edge.props.fromPort, 'output')
	const end = portPagePoint(editor, to, edge.props.toPort, 'input')
	return start && end ? { start, end } : undefined
}
function edgeControls(start: { x: number; y: number }, end: { x: number; y: number }) {
	const bend = Math.max(40, Math.abs(end.x - start.x) / 2)
	return { c1:{ x:start.x + bend, y:start.y }, c2:{ x:end.x - bend, y:end.y } }
}
function edgePath(start: { x: number; y: number }, end: { x: number; y: number }) {
	const { c1, c2 } = edgeControls(start, end)
	return `M${start.x} ${start.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`
}
// The same cubic, sampled, so the curve itself is the hit target (click to select, Backspace to delete).
function edgeSamples(start: { x: number; y: number }, end: { x: number; y: number }, steps = 24) {
	const { c1, c2 } = edgeControls(start, end)
	return Array.from({ length:steps + 1 }, (_, i) => {
		const t = i / steps, u = 1 - t
		return new Vec(u*u*u*start.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*end.x, u*u*u*start.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*end.y)
	})
}

const shapeIdValidator = T.string.refine(value => value as TLShapeId)
function AteliEdgeView({ shape, editor }: { shape: AteliEdgeShape; editor: Editor }) {
	const points = useValue('ateli edge points', () => edgePoints(editor, shape), [editor, shape])
	const drag = useDrag(editor)
	if (!points || drag?.edgeId === shape.id) return null
	return (
		<svg className="pointer-events-none absolute overflow-visible" style={{ left:0, top:0 }} width={1} height={1} aria-hidden>
			<path d={edgePath(points.start, points.end)} fill="none" stroke={portColor[shape.props.valueType]} strokeWidth={1.75} strokeLinecap="round" />
			<circle className="pointer-events-auto cursor-crosshair" cx={points.end.x} cy={points.end.y} r={7} fill="transparent" onPointerDown={event => { const source = sourceForEdge(editor, shape); if (source) beginDomDrag(editor, source, event, shape.id) }} />
		</svg>
	)
}

export class AteliEdgeShapeUtil extends ShapeUtil<AteliEdgeShape> {
	static override type = 'ateli-edge' as const
	static override props: RecordProps<AteliEdgeShape> = { from:shapeIdValidator, fromPort:T.string, to:shapeIdValidator, toPort:T.string, valueType:T.literalEnum('mesh', 'image', 'text', 'number', 'boolean', 'enum', 'mesh[]', 'image[]', 'text[]', 'number[]', 'boolean[]') }
	getDefaultProps(): AteliEdgeProps { return { from:'' as TLShapeId, fromPort:'', to:'' as TLShapeId, toPort:'', valueType:'mesh' } }
	override canResize() { return false }
	override hideRotateHandle() { return true }
	override hideSelectionBoundsFg() { return true }
	override hideSelectionBoundsBg() { return true }
	override canBind() { return false }
	getGeometry(shape: AteliEdgeShape) {
		const points = edgePoints(this.editor, shape)
		if (!points) return new Rectangle2d({ width:1, height:1, isFilled:false })
		return new Polyline2d({ points:edgeSamples(points.start, points.end) })
	}
	component(shape: AteliEdgeShape) { dragChannel(this.editor); return <AteliEdgeView shape={shape} editor={this.editor} /> }
	override getIndicatorPath(shape: AteliEdgeShape) { const path = new Path2D(); const points = edgePoints(this.editor, shape); if (points) path.addPath(new Path2D(edgePath(points.start, points.end))); return path }
}

function nodeProps(toolId: string): AteliNodeProps {
	const tool = (getTool(toolId) ?? placeholderTool(toolId))
	const base: AteliNodeProps = { w:nodeWidth, h:0, toolId:tool.id, values:defaultValues(tool), results:{}, collapsed:false }
	return { ...base, h:nodeHeight({ props:base } as AteliNodeShape, false) }
}

export function createAteliNode(editor: Editor, toolId: string, point?: { x: number; y: number }, id = createShapeId()) {
	const props = nodeProps(toolId)
	const center = point ?? editor.getViewportPageBounds().center
	editor.createShape<AteliNodeShape>({ id, type:'ateli-node', x:center.x - props.w / 2, y:center.y - props.h / 2, props })
	return id
}

function toolPort(node: AteliNodeShape, portId: string, side: 'inputs' | 'outputs') {
	return getTool(node.props.toolId)![side].find(port => port.id === portId)!
}

export function seedAteliGraph(editor: Editor) {
	if (editor.getIsReadonly()) return
	editor.markHistoryStoppingPoint('Create sample graph')
	const existing = editor.getCurrentPageShapes().filter(shape => shape.type === 'ateli-node' || shape.type === 'ateli-edge')
	if (existing.length) editor.deleteShapes(existing.map(shape => shape.id))
	const center = editor.getViewportPageBounds().center
	const at = (x: number, y: number) => ({ x:center.x + x, y:center.y + y })
	const meshInput = createAteliNode(editor, 'input.mesh', at(-700, -120))
	const optimize = createAteliNode(editor, 'mesh.optimize', at(-360, -120))
	const extract = createAteliNode(editor, 'mesh.extractTextures', at(-20, -220))
	const apply = createAteliNode(editor, 'mesh.applyTextures', at(360, -80))
	const imageInput = createAteliNode(editor, 'input.image', at(-360, 300))
	const filter = createAteliNode(editor, 'image.filter', at(-20, 300))
	const node = (id: TLShapeId) => editor.getShape<AteliNodeShape>(id)!
	const connect = (from: TLShapeId, fromPort: string, to: TLShapeId, toPort: string) => connectPorts(editor, { shapeId:from, port:toolPort(node(from), fromPort, 'outputs') }, to, toolPort(node(to), toPort, 'inputs'))
	connect(meshInput, 'mesh', optimize, 'mesh')
	connect(optimize, 'mesh', extract, 'mesh')
	connect(optimize, 'mesh', apply, 'mesh')
	connect(extract, 'roughness', apply, 'roughness')
	connect(extract, 'metallic', apply, 'metallic')
	connect(extract, 'normal', apply, 'normal')
	connect(imageInput, 'image', filter, 'image')
	connect(filter, 'image', apply, 'baseColor')
	editor.select(meshInput, optimize, extract, apply, imageInput, filter)
	editor.zoomToSelection({ animation:{ duration:0 } })
	editor.selectNone()
}

export function seedCharacterMotionGraph(editor: Editor) {
	if (editor.getIsReadonly()) return
	editor.markHistoryStoppingPoint('Create character motion graph')
	const existing = editor.getCurrentPageShapes().filter(shape => shape.type === 'ateli-node' || shape.type === 'ateli-edge')
	if (existing.length) editor.deleteShapes(existing.map(shape => shape.id))
	const center = editor.getViewportPageBounds().center
	const at = (x: number, y: number) => ({ x:center.x + x, y:center.y + y })
	const meshInput = createAteliNode(editor, 'input.mesh', at(-1000, 0))
	const rig = createAteliNode(editor, 'character.rig', at(-680, 0))
	const idle = createAteliNode(editor, 'motion.fromText', at(-340, -300))
	const walk = createAteliNode(editor, 'motion.fromText', at(-340, 0))
	const attack = createAteliNode(editor, 'motion.fromText', at(-340, 300))
	const collect = createAteliNode(editor, 'list.collectMeshes', at(20, 280))
	const merge = createAteliNode(editor, 'mesh.mergeAnimations', at(340, 0))
	const compress = createAteliNode(editor, 'mesh.compress', at(680, 0))
	const exportNode = createAteliNode(editor, 'output.export', at(1020, 0))
	const node = (id: TLShapeId) => editor.getShape<AteliNodeShape>(id)!
	const setValues = (id: TLShapeId, values: Record<string, JsonValue>) => editor.updateShape<AteliNodeShape>({ id, type:'ateli-node', props:{ values:{ ...node(id).props.values, ...values } } })
	const connect = (from: TLShapeId, fromPort: string, to: TLShapeId, toPort: string) => connectPorts(editor, { shapeId:from, port:toolPort(node(from), fromPort, 'outputs') }, to, toolPort(node(to), toPort, 'inputs'))
	setValues(idle, { clipName:'idle', prompt:'Standing idle, breathing naturally with subtle shifts of weight.' })
	setValues(walk, { clipName:'walk', prompt:'Walk forward at a steady relaxed pace.' })
	setValues(attack, { clipName:'attack', prompt:'Raise a rifle to the shoulder, fire once, and recover to a ready stance.' })
	setValues(exportNode, { name:'{dir}' })
	connect(meshInput, 'mesh', rig, 'mesh')
	for (const motion of [idle, walk, attack]) connect(rig, 'character', motion, 'character')
	connect(idle, 'mesh', collect, 'item')
	connect(walk, 'mesh', collect, 'item')
	connect(attack, 'mesh', collect, 'item')
	connect(walk, 'mesh', merge, 'base')
	connect(collect, 'list', merge, 'clips')
	connect(merge, 'mesh', compress, 'mesh')
	connect(compress, 'mesh', exportNode, 'mesh')
	const nodes = [meshInput, rig, idle, walk, attack, collect, merge, compress, exportNode]
	editor.select(...nodes)
	editor.zoomToSelection({ animation:{ duration:0 } })
	editor.selectNone()
}
