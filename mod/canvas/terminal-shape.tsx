import { useEffect, useRef, type SyntheticEvent } from 'react'
import { SquareTerminal } from 'lucide-react'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, resizeBox, type Editor, type RecordProps, type TLBaseShape, type TLResizeInfo } from 'tldraw'
import { backendUrl } from './backend'
import { cn } from '@/lib/utils'
import { EditingBoxShapeTool, useShapeEditing } from '../skin/tool-chrome'

// The terminal is a page served by the local backend (terminal-page.html): xterm.js over a WebSocket to a node-pty shell.
const terminalUrl = `${backendUrl}/terminal/`
const stop = (event: SyntheticEvent) => event.stopPropagation()

export interface TerminalProps { w: number; h: number }
declare module '@tldraw/tlschema' { interface TLGlobalShapePropsMap { terminal: TerminalProps } }
export type TerminalShape = TLBaseShape<'terminal', TerminalProps>

export const terminalIcon = <SquareTerminal size={24} aria-hidden />

function TerminalShapeView({ shape, editor }: { shape: TerminalShape; editor: Editor }) {
	const { editing } = useShapeEditing(editor, shape)
	const frame = useRef<HTMLIFrameElement>(null)
	useEffect(() => { if (editing) frame.current?.focus() }, [editing])
	return (
		<HTMLContainer className="overflow-hidden rounded-none bg-[#171817] shadow-[0_0_0_1px_#00000024]" style={{ width: shape.props.w, height: shape.props.h }}>
			<iframe
				ref={frame} src={terminalUrl} title="Terminal" className={cn('block size-full border-0 bg-[#171817]', editing ? 'pointer-events-auto' : 'pointer-events-none')}
				sandbox="allow-scripts allow-same-origin" allow="clipboard-read; clipboard-write"
				tabIndex={editing ? 0 : -1} onPointerDown={stop}
			/>
			{editing ? null : <div className="absolute inset-0 cursor-default" title="Double-click to use the terminal. Click the canvas to finish." />}
		</HTMLContainer>
	)
}
export class TerminalShapeUtil extends ShapeUtil<TerminalShape> {
	static override type = 'terminal' as const
	static override props: RecordProps<TerminalShape> = { w: T.number, h: T.number }
	getDefaultProps(): TerminalProps { return { w: 720, h: 420 } }
	override canEdit() { return true }
	override canResize() { return true }
	override hideRotateHandle() { return true }
	override getAriaDescriptor() { return 'Terminal' }
	getGeometry(shape: TerminalShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }) }
	component(shape: TerminalShape) { return <TerminalShapeView shape={shape} editor={this.editor} /> }
	override getIndicatorPath(shape: TerminalShape) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path }
	override onResize(shape: TerminalShape, info: TLResizeInfo<TerminalShape>) { return resizeBox(shape, info, { minWidth: 320, minHeight: 180 }) }
	override toSvg(shape: TerminalShape) {
		return (
			<g>
				<rect width={shape.props.w} height={shape.props.h} rx={10} fill="#171817" />
				<text x={16} y={28} fill="#f3f1e9" fontFamily="monospace" fontSize={13}>Terminal</text>
			</g>
		)
	}
}

export class TerminalShapeTool extends EditingBoxShapeTool {
	static override id = 'terminal'
	static override initial = 'idle'
	override shapeType = 'terminal' as const
}
