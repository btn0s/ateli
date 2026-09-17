import { ChevronUp, Monitor, Moon, PanelsTopLeft, Sun } from 'lucide-react'
import type { ConfigScriptContext } from 'tldraw-offline/script-context'
import { ArrowToolbarItem, AssetToolbarItem, DefaultContextMenu, DefaultContextMenuContent, DefaultToolbar, DrawToolbarItem, EraserToolbarItem, HandToolbarItem, NoteToolbarItem, RectangleToolbarItem, SelectToolbarItem, TextToolbarItem, TldrawUiInFrontOfTheCanvas, TldrawUiMenuGroup, TldrawUiMenuItem, useDialogs, useEditor, type Editor, type TLUiContextMenuProps } from 'tldraw'
import { AteliEdgeOverlay, AteliEdgeShapeUtil, AteliNodeShapeTool, AteliNodeShapeUtil, ateliNodeIcon, createAteliNode, seedAteliGraph } from './graph/ateli-node-shape'
import { catalog, loadCatalog, type AteliCategory } from './graph/ateli-tools'
import { BrowserShapeTool, BrowserShapeUtil } from './canvas/browser-shape'
import { Feedback } from './canvas/feedback'
import { ImageGenShapeTool, ImageGenShapeUtil, imageGenIcon } from './canvas/image-gen-shape'
import { LandmarkShapeTool, LandmarkShapeUtil, createLandmark, landmarkIcon } from './canvas/landmark-shape'
import { TerminalShapeTool, TerminalShapeUtil, terminalIcon } from './canvas/terminal-shape'
import { CommandBar, toggleCommandBar, type Palette, type PaletteCommand } from './skin/command-bar'
import { toolbarIconsCss } from './skin/toolbar-icons'
import { uiCss } from './skin/ui'
// Compiled by the build's Tailwind plugin from mod/skin/styles/globals.css against the classes used under mod/.
import tailwindCss from './skin/styles/globals.css'

const css = `
${tailwindCss}
${uiCss}
`
const personalTools: Palette['personalTools'] = [
	{ id: 'ateli-node', label: 'Ateli node', icon: ateliNodeIcon },
	{ id: 'browser', label: 'Browser', icon: <PanelsTopLeft size={24} aria-hidden /> },
	{ id: 'image-gen', label: 'Generate image', icon: imageGenIcon },
	{ id: 'landmark', label: 'Landmark', icon: landmarkIcon },
	{ id: 'terminal', label: 'Terminal', icon: terminalIcon },
]

const ateliCategories: AteliCategory[] = ['Input', 'Image', 'Mesh']
// "Add <tool>" entries come from the bridge catalog, so they are computed when the palette or context menu opens.
function commands(): PaletteCommand[] {
	const tools = catalog.get()
	return [
		{ id:'ateli-seed-graph', label:'Create sample graph', icon:ateliNodeIcon, run:seedAteliGraph },
		...ateliCategories.flatMap(category => tools.filter(tool => tool.category === category).map(tool => ({
			id:`ateli-add-${tool.id}`,
			label:`Add ${tool.title}`,
			icon:ateliNodeIcon,
			run:(editor: Editor) => createAteliNode(editor, tool.id),
		}))),
		{ id:'create-landmark', label:'Create landmark', icon:landmarkIcon, run:createLandmark },
	]
}
const preferenceCommands: PaletteCommand[] = [
	{
		id:'theme-light', label:'Set theme to Light', icon:<Sun size={18} aria-hidden />, readonlyOk:true,
		run(editor, trackEvent) {
			editor.user.updateUserPreferences({ colorScheme:'light' })
			trackEvent?.('color-scheme', { source:'dialog', value:'light' })
		},
	},
	{
		id:'theme-dark', label:'Set theme to Dark', icon:<Moon size={18} aria-hidden />, readonlyOk:true,
		run(editor, trackEvent) {
			editor.user.updateUserPreferences({ colorScheme:'dark' })
			trackEvent?.('color-scheme', { source:'dialog', value:'dark' })
		},
	},
	{
		id:'theme-system', label:'Set theme to System', icon:<Monitor size={18} aria-hidden />, readonlyOk:true,
		run(editor, trackEvent) {
			editor.user.updateUserPreferences({ colorScheme:'system' })
			trackEvent?.('color-scheme', { source:'dialog', value:'system' })
		},
	},
]
const preferenceActionIds = [
	'toggle-snap-mode',
	'toggle-tool-lock',
	'toggle-grid',
	'toggle-wrap-mode',
	'toggle-focus-mode',
	'toggle-edge-scrolling',
	'toggle-dynamic-size-mode',
	'toggle-paste-at-cursor',
	'toggle-debug-mode',
]
const palette: Palette = { personalTools, get commands() { return commands() }, preferenceCommands, preferenceActionIds }

// The command bar is the drawer: every tool outside the main row, including the personal ones, is reached through it.
function MoreToolsItem() {
	const dialogs = useDialogs()
	return <TldrawUiMenuItem id="more" label="More tools" kbd="$k" icon={<ChevronUp size={24} aria-hidden />} readonlyOk onSelect={() => toggleCommandBar(dialogs, palette)} />
}

function ContextMenu(props: TLUiContextMenuProps) {
	const editor = useEditor()
	function run(command: PaletteCommand) {
		// tldraw does not expose Radix's onCloseAutoFocus; cancel the menu's focus return so the command can focus a shape input.
		editor.getContainer().querySelector('[data-testid="context-menu"]')?.addEventListener('focusScope.autoFocusOnUnmount', event => event.preventDefault(), { once: true })
		command.run(editor)
	}
	return (
		<DefaultContextMenu {...props}>
			<TldrawUiMenuGroup id="personal-commands">
				{commands().map(command => <TldrawUiMenuItem key={command.id} id={command.id} label={command.label} onSelect={() => run(command)} />)}
			</TldrawUiMenuGroup>
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	)
}

const toolbarItems = [SelectToolbarItem, HandToolbarItem, DrawToolbarItem, EraserToolbarItem, ArrowToolbarItem, TextToolbarItem, NoteToolbarItem, AssetToolbarItem, RectangleToolbarItem, MoreToolsItem]

function Toolbar() {
	return (
		<>
			<style>{css + toolbarIconsCss}</style>
			<DefaultToolbar maxItems={toolbarItems.length} maxSizePx={toolbarItems.length * 50}>
				{toolbarItems.map(Item => <Item key={Item.name} />)}
			</DefaultToolbar>
		</>
	)
}

export default function ({ config }: ConfigScriptContext) {
	const ExistingCanvasUi = config.components.InFrontOfTheCanvas ?? TldrawUiInFrontOfTheCanvas
	void loadCatalog()
	config.shapeUtils.push(AteliNodeShapeUtil, AteliEdgeShapeUtil, BrowserShapeUtil, ImageGenShapeUtil, LandmarkShapeUtil, TerminalShapeUtil)
	config.tools.push(AteliNodeShapeTool, BrowserShapeTool, ImageGenShapeTool, LandmarkShapeTool, TerminalShapeTool)
	config.components = {
		...config.components,
		Toolbar,
		ContextMenu,
		InFrontOfTheCanvas: () => <><ExistingCanvasUi /><AteliEdgeOverlay /><Feedback /><CommandBar palette={palette} /></>,
	}
	return config
}
