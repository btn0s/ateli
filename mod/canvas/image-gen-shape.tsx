import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ImagePlus, LoaderCircle } from 'lucide-react'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, resizeBox, useValue, type Editor, type RecordProps, type TLBaseShape, type TLResizeInfo } from 'tldraw'
import { backendUrl } from './backend'
import { cn } from '@/lib/utils'
import { EditingBoxShapeTool, ToolChromeField, useShapeEditing } from '../skin/tool-chrome'

const endpoint = `${backendUrl}/generate`
const isImage = (src: unknown): src is string => typeof src === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(src)

export interface ImageGenProps { w: number; h: number; prompt: string; src: string; imageWidth: number; imageHeight: number }
declare module '@tldraw/tlschema' { interface TLGlobalShapePropsMap { 'image-gen': ImageGenProps } }
export type ImageGenShape = TLBaseShape<'image-gen', ImageGenProps>

// One in-flight generation: aborting the fetch and detaching the store hooks that watch for the shape changing under it.
interface ActiveRequest { controller: AbortController; dispose(): void }


export const imageGenIcon = <ImagePlus size={24} aria-hidden />

function ImageGenShapeView({ shape, editor }: { shape: ImageGenShape; editor: Editor }) {
	const { editing, readonly, dark, finish } = useShapeEditing(editor, shape)
	const hovered = useValue('image generation hovered', () => editor.getHoveredShapeId() === shape.id, [editor, shape.id])
	const [pending, setPending] = useState(false)
	const [error, setError] = useState('')
	const request = useRef<ActiveRequest | null>(null)
	const hasImage = isImage(shape.props.src)

	function cancelPending(updateState = true) {
		const active = request.current
		if (!active) return
		request.current = null
		active.dispose()
		active.controller.abort()
		if (updateState) setPending(false)
	}

	useEffect(() => () => cancelPending(false), [editor, shape.id])

	function changePrompt(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
		cancelPending()
		setError('')
		editor.updateShape({ id: shape.id, type: 'image-gen', props: { prompt: event.currentTarget.value } })
	}

	async function generate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (request.current || readonly) return
		const current = editor.getShape(shape.id)
		if (!current || current.type !== 'image-gen' || !current.props.prompt.trim()) return
		const prompt = current.props.prompt
		const src = current.props.src
		const scale = Math.min(1, 4096 / Math.max(current.props.w, current.props.h))
		const width = Math.max(64, Math.round(current.props.w * scale))
		const height = Math.max(64, Math.round(current.props.h * scale))
		const controller = new AbortController()
		const active: ActiveRequest = { controller, dispose: () => {} }
		request.current = active
		setError('')
		setPending(true)

		// Synchronous hooks also catch delete/undo and edit/undo within one render.
		const removeChange = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
			if (next.id !== shape.id) return
			const before = prev as ImageGenShape
			if (next.type !== 'image-gen' || before.props.prompt !== next.props.prompt || before.props.src !== next.props.src || next.isLocked) cancelPending()
		})
		const removeDelete = editor.sideEffects.registerAfterDeleteHandler('shape', (deleted) => {
			if (deleted.id === shape.id) cancelPending()
		})
		let disposed = false
		active.dispose = () => {
			if (disposed) return
			disposed = true
			// Do not splice tldraw's handler list while it is notifying other shapes.
			queueMicrotask(() => { removeChange(); removeDelete() })
		}

		try {
			const response = await fetch(endpoint, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
				body: JSON.stringify({ prompt, width, height, requestId: crypto.randomUUID() }), signal: controller.signal,
			})
			const result: { error?: { message?: string }; dataUrl?: unknown; width?: number; height?: number } = await response.json()
			if (!response.ok) throw new Error(result.error?.message || `Generation failed (${response.status}).`)
			if (!isImage(result.dataUrl) || !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width! < 1 || result.height! < 1) {
				throw new Error('Imgen returned an invalid image response.')
			}
			const latest = editor.getShape(shape.id)
			if (request.current !== active || !latest || latest.type !== 'image-gen' || latest.props.prompt !== prompt || latest.props.src !== src || editor.getInstanceState().isReadonly || editor.isShapeOrAncestorLocked(shape.id)) return
			request.current = null
			active.dispose()
			editor.markHistoryStoppingPoint('Generate image')
			editor.updateShape({ id: shape.id, type: 'image-gen', props: { src: result.dataUrl, imageWidth: result.width, imageHeight: result.height } })
			setPending(false)
			if (editor.getEditingShapeId() === shape.id) finish()
		} catch (err) {
			if (request.current === active && !controller.signal.aborted) {
				setError(err instanceof TypeError ? 'The local backend is offline. It restarts by itself (npm run service status); try again in a moment.' : (err as Error).message)
			}
		} finally {
			active.dispose()
			if (request.current === active) {
				request.current = null
				setPending(false)
			}
		}
	}

	// The prompt lives in a scrim along the bottom edge: hidden until the shape is hovered, edited, generating, or failed.
	const showOverlay = hovered || pending || !!error
	return (
		<HTMLContainer className="overflow-hidden rounded-none font-sans text-xs/[18px] text-foreground antialiased" style={{ width: shape.props.w, height: shape.props.h, colorScheme: dark ? 'dark' : 'light' }}>
			<div className={cn('pointer-events-none absolute inset-0 overflow-hidden bg-[color-mix(in_srgb,var(--card)_92%,var(--foreground))] outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10', pending && 'after:absolute after:inset-0 after:animate-shimmer after:bg-[linear-gradient(110deg,transparent_20%,color-mix(in_srgb,var(--foreground)_6%,transparent)_40%,color-mix(in_srgb,var(--foreground)_14%,transparent)_50%,color-mix(in_srgb,var(--foreground)_6%,transparent)_60%,transparent_80%)] after:content-[""] motion-reduce:after:animate-none')}>
				{hasImage ? <img className={cn('block size-full rounded-none object-cover', pending && 'opacity-45')} src={shape.props.src} alt={shape.props.prompt} draggable={false} /> : null}
			</div>
			<form
				className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-[linear-gradient(to_top,#000000b3,#00000059_60%,transparent)] px-3.5 pt-7 pb-3 text-white transition-opacity duration-150 motion-reduce:transition-none', editing ? 'pointer-events-auto opacity-100' : showOverlay ? 'opacity-55' : 'opacity-0')}
				onSubmit={generate} aria-busy={pending} onPointerDown={editing ? (event) => event.stopPropagation() : undefined}
			>
				<div className="flex items-end gap-3">
					<ToolChromeField
						multiline submit="mod-enter" className="min-w-0 flex-1 after:min-h-[18px] after:p-0" controlClassName="min-h-[18px] p-0 placeholder:text-white/60"
						value={shape.props.prompt} placeholder="Describe an image…" aria-label="Image prompt"
						maxLength={8000} disabled={readonly} readOnly={pending} tabIndex={editing ? 0 : -1} focus={editing && !readonly} onEscape={finish}
						onChange={changePrompt} onFocus={() => { editor.markHistoryStoppingPoint('Edit image prompt'); editor.select(shape.id) }}
					/>
					<span className="inline-flex h-[18px] shrink-0 items-center font-mono text-[10px]/none tracking-[.06em] text-white/60" role={pending ? 'status' : undefined} aria-label={pending ? 'Generating image' : undefined} aria-hidden={!pending}>
						{pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={14} aria-hidden /> : '⌘↵'}
					</span>
				</div>
				{error ? <p className="m-0 [overflow-wrap:anywhere] text-[#ffb4a8] select-text" role="alert">{error}</p> : null}
			</form>
		</HTMLContainer>
	)
}

export class ImageGenShapeUtil extends ShapeUtil<ImageGenShape> {
	static override type = 'image-gen' as const
	static override props: RecordProps<ImageGenShape> = { w: T.number, h: T.number, prompt: T.string, src: T.string, imageWidth: T.number, imageHeight: T.number }
	getDefaultProps(): ImageGenProps { return { w: 640, h: 480, prompt: '', src: '', imageWidth: 0, imageHeight: 0 } }
	override canEdit() { return true }
	override canResize() { return true }
	override hideRotateHandle() { return true }
	override getAriaDescriptor(shape: ImageGenShape) { return `Image: ${shape.props.prompt || 'empty prompt'}` }
	getGeometry(shape: ImageGenShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }) }
	component(shape: ImageGenShape) { return <ImageGenShapeView shape={shape} editor={this.editor} /> }
	override getIndicatorPath(shape: ImageGenShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}
	override onResize(shape: ImageGenShape, info: TLResizeInfo<ImageGenShape>) { return resizeBox(shape, info, { minWidth: 160, minHeight: 100 }) }
	override toSvg(shape: ImageGenShape) {
		return isImage(shape.props.src) ? <image href={shape.props.src} width={shape.props.w} height={shape.props.h} preserveAspectRatio="xMidYMid slice" /> : null
	}
}

export class ImageGenShapeTool extends EditingBoxShapeTool {
	static override id = 'image-gen'
	static override initial = 'idle'
	override shapeType = 'image-gen' as const
}

