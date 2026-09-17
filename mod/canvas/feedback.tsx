import { useEffect, type SyntheticEvent } from 'react'
import { Agentation } from 'agentation'
import { feedbackUrl } from './backend'

const pointerEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()

// Agentation 3.0.2 has no active-mode callback. Its cursor stylesheet exists
// exactly while feedback mode is active, including drawing and layout modes.
const feedbackCss = `
html:has(#feedback-cursor-styles) .browser-frame { pointer-events:none !important; }
[data-agentation-root] [data-agentation-toolbar] > div[role=button] { width:40px; height:40px; transition:width 400ms ease,transform 120ms ease; }
[data-agentation-root] [data-agentation-toolbar] > div[role=button]:active { transform:scale(.96); }
[data-agentation-root] [data-agentation-toolbar] > div[role=button] svg { width:18px; height:18px; }
@media (prefers-reduced-motion:reduce) { [data-agentation-root] [data-agentation-toolbar] > div[role=button] { transition:none; } }
`

export function Feedback() {
	useEffect(() => {
		const guardCanvasPointer = (event: Event) => {
			if (!document.getElementById('feedback-cursor-styles')) return
			const target = event.composedPath()[0]
			if (target instanceof Element && target.closest('[data-agentation-root]')) return
			// tldraw consumes pointer events; Agentation consumes mouse events.
			// Do not preventDefault: that would suppress the compatibility mouse
			// events Agentation needs for annotation clicks and drag selection.
			event.stopPropagation()
		}
		for (const type of pointerEvents) {
			document.addEventListener(type, guardCanvasPointer, true)
		}
		return () => {
			for (const type of pointerEvents) {
				document.removeEventListener(type, guardCanvasPointer, true)
			}
		}
	}, [])

	// Agentation portals to document.body, but React events still bubble through
	// this component's editor ancestry. Isolate its UI without replacing any
	// editor handlers or blocking Agentation's document-level mouse listeners.
	return (
		<div
			style={{ display: 'contents' }}
			onPointerDown={stopPropagation} onPointerMove={stopPropagation} onPointerUp={stopPropagation} onPointerCancel={stopPropagation}
			onClick={stopPropagation} onDoubleClick={stopPropagation} onContextMenu={stopPropagation} onKeyDown={stopPropagation} onKeyUp={stopPropagation}
		>
			<style>{feedbackCss}</style>
			<Agentation endpoint={feedbackUrl} />
		</div>
	)
}
