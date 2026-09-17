import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import { atom, useEditor, useValue } from 'tldraw'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

export interface LightboxResult {
	title: string
	kind: 'image' | 'mesh'
	previewUrl: string
	downloadUrl: string
}

type MaterialMode = 'lit' | 'wireframe' | 'normals' | 'unlit'
type MeshMaterial = THREE.Material | THREE.Material[]
type ModelMaterials = Map<THREE.Mesh, MeshMaterial>

export const lightbox = atom<LightboxResult | null>('ateli lightbox', null)

export function openLightbox(result: LightboxResult) {
	lightbox.set(result)
}

function materialsOf(material: MeshMaterial) {
	return Array.isArray(material) ? material : [material]
}

function texturesOf(material: THREE.Material) {
	return Object.values(material).filter((value): value is THREE.Texture => value instanceof THREE.Texture)
}

function disposeObject(root: THREE.Object3D) {
	const geometries = new Set<THREE.BufferGeometry>()
	const materials = new Set<THREE.Material>()
	const textures = new Set<THREE.Texture>()
	root.traverse(object => {
		const renderable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: MeshMaterial }
		if (renderable.geometry) geometries.add(renderable.geometry)
		if (!renderable.material) return
		for (const material of materialsOf(renderable.material)) {
			materials.add(material)
			for (const texture of texturesOf(material)) textures.add(texture)
		}
	})
	for (const geometry of geometries) geometry.dispose()
	for (const material of materials) material.dispose()
	for (const texture of textures) texture.dispose()
}

function replacementMaterials(material: MeshMaterial, create: (source: THREE.Material) => THREE.Material): MeshMaterial {
	return Array.isArray(material) ? material.map(create) : create(material)
}

function unlitMaterial(source: THREE.Material) {
	const original = source as THREE.Material & {
		map?: THREE.Texture | null
		alphaMap?: THREE.Texture | null
		color?: THREE.Color
		vertexColors?: boolean
		opacity?: number
		transparent?: boolean
		alphaTest?: number
		side?: THREE.Side
	}
	return new THREE.MeshBasicMaterial({
		map: original.map ?? null,
		alphaMap: original.alphaMap ?? null,
		color: original.color?.clone() ?? new THREE.Color(0xffffff),
		vertexColors: original.vertexColors ?? false,
		opacity: original.opacity ?? 1,
		transparent: original.transparent ?? false,
		alphaTest: original.alphaTest ?? 0,
		side: original.side ?? THREE.FrontSide,
	})
}

function applyMaterialMode(originals: ModelMaterials, mode: MaterialMode, transient: Set<THREE.Material>) {
	for (const material of transient) material.dispose()
	transient.clear()
	for (const [mesh, original] of originals) {
		if (mode === 'lit') {
			mesh.material = original
			continue
		}
		if (mode === 'normals') {
			const normal = new THREE.MeshNormalMaterial()
			transient.add(normal)
			mesh.material = normal
			continue
		}
		const replacement = replacementMaterials(original, source => {
			const next = mode === 'unlit' ? unlitMaterial(source) : source.clone()
			if (mode === 'wireframe' && 'wireframe' in next) (next as THREE.MeshStandardMaterial).wireframe = true
			transient.add(next)
			return next
		})
		mesh.material = replacement
	}
}

function MeshViewer({ url, mode }: { url: string; mode: MaterialMode }) {
	const host = useRef<HTMLDivElement>(null)
	const modeRef = useRef(mode)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	modeRef.current = mode

	useEffect(() => {
		if (!host.current) return
		const container = host.current
		let disposed = false
		let frame = 0
		let model: THREE.Object3D | undefined
		let grid: THREE.GridHelper | undefined
		const originals: ModelMaterials = new Map()
		const transient = new Set<THREE.Material>()
		const scene = new THREE.Scene()
		scene.background = new THREE.Color('#151515')
		const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
		const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true })
		renderer.outputColorSpace = THREE.SRGBColorSpace
		renderer.toneMapping = THREE.ACESFilmicToneMapping
		renderer.toneMappingExposure = 1
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
		renderer.domElement.setAttribute('aria-label', '3D result viewer')
		container.append(renderer.domElement)

		const controls = new OrbitControls(camera, renderer.domElement)
		controls.enableDamping = true
		controls.autoRotate = false
		const hemisphere = new THREE.HemisphereLight(0xddeeff, 0x252018, 1.8)
		const key = new THREE.DirectionalLight(0xffffff, 3.2)
		key.position.set(4, 7, 5)
		const fill = new THREE.DirectionalLight(0x88aaff, 1.1)
		fill.position.set(-4, 2, -3)
		scene.add(hemisphere, key, fill)

		const materialMode = (event: Event) => {
			const next = (event as CustomEvent<MaterialMode>).detail
			modeRef.current = next
			if (originals.size) applyMaterialMode(originals, next, transient)
		}
		container.addEventListener('ateli-material-mode', materialMode)

		function resize() {
			const width = Math.max(container.clientWidth, 1)
			const height = Math.max(container.clientHeight, 1)
			camera.aspect = width / height
			camera.updateProjectionMatrix()
			renderer.setSize(width, height, false)
		}
		resize()
		const resizeObserver = new ResizeObserver(resize)
		resizeObserver.observe(container)
		window.addEventListener('resize', resize)

		function render() {
			controls.update()
			renderer.render(scene, camera)
			frame = requestAnimationFrame(render)
		}
		render()

		const request = new AbortController()
		function fail(reason: unknown) {
			if (disposed || (reason instanceof DOMException && reason.name === 'AbortError')) return
			setLoading(false)
			setError(reason instanceof Error ? reason.message : 'Could not load this mesh.')
		}
		function loadModel(gltf: GLTF) {
			if (disposed) {
				disposeObject(gltf.scene)
				return
			}
			model = gltf.scene
			model.traverse(object => {
				if (object instanceof THREE.Mesh) originals.set(object, object.material)
			})
			const box = new THREE.Box3().setFromObject(model)
			const sphere = box.getBoundingSphere(new THREE.Sphere())
			const radius = Math.max(sphere.radius, 0.001)
			const verticalFov = THREE.MathUtils.degToRad(camera.fov)
			const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
			const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.15
			camera.near = Math.max(distance / 1000, 0.0001)
			camera.far = distance * 100
			camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(distance))
			camera.updateProjectionMatrix()
			controls.target.copy(sphere.center)
			controls.minDistance = radius * 0.05
			controls.maxDistance = radius * 20
			controls.update()

			grid = new THREE.GridHelper(radius * 4, 20, 0x666666, 0x333333)
			grid.position.set(sphere.center.x, box.min.y, sphere.center.z)
			for (const material of materialsOf(grid.material)) {
				material.transparent = true
				material.opacity = 0.35
				material.depthWrite = false
			}
			scene.add(model, grid)
			applyMaterialMode(originals, modeRef.current, transient)
			setLoading(false)
		}
		void fetch(url, { signal:request.signal }).then(response => {
			if (!response.ok) throw new Error(`Mesh download failed (${response.status})`)
			return response.arrayBuffer()
		}).then(data => {
			if (disposed) return
			// Electron's custom app protocol cannot fetch the blob URLs used by ImageBitmapLoader.
			// TextureLoader uses image elements instead, which handle those embedded GLB textures.
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
			try {
				Object.defineProperty(globalThis, 'createImageBitmap', { value:undefined, configurable:true, writable:true })
				new GLTFLoader().parse(data, '', loadModel, fail)
			} finally {
				if (descriptor) Object.defineProperty(globalThis, 'createImageBitmap', descriptor)
				else Reflect.deleteProperty(globalThis, 'createImageBitmap')
			}
		}).catch(fail)

		return () => {
			disposed = true
			request.abort()
			cancelAnimationFrame(frame)
			window.removeEventListener('resize', resize)
			container.removeEventListener('ateli-material-mode', materialMode)
			resizeObserver.disconnect()
			controls.dispose()
			for (const [mesh, original] of originals) mesh.material = original
			for (const material of transient) material.dispose()
			transient.clear()
			if (model) disposeObject(model)
			if (grid) disposeObject(grid)
			scene.clear()
			renderer.renderLists.dispose()
			renderer.dispose()
			renderer.forceContextLoss()
			renderer.domElement.remove()
		}
	}, [url])

	useEffect(() => {
		const container = host.current
		if (!container) return
		// The loader effect owns the meshes. A custom event keeps material switching synchronous
		// without rebuilding the WebGL renderer or reloading the GLB.
		container.dispatchEvent(new CustomEvent<MaterialMode>('ateli-material-mode', { detail:mode }))
	}, [mode])

	return (
		<div className="relative h-[86vh] w-[92vw] max-h-[calc(100vh-76px)] overflow-hidden rounded-lg bg-[#151515]">
			<div ref={host} className="size-full" />
			{loading ? <div className="ui-label pointer-events-none absolute top-3 left-3 text-white/70">Loading mesh</div> : null}
			{error ? <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-red-300">{error}</div> : null}
		</div>
	)
}

const checkerboard = {
	backgroundColor:'#d4d4d4',
	backgroundImage:'linear-gradient(45deg,#f5f5f5 25%,transparent 25%),linear-gradient(-45deg,#f5f5f5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f5f5f5 75%),linear-gradient(-45deg,transparent 75%,#f5f5f5 75%)',
	backgroundPosition:'0 0,0 8px,8px -8px,-8px 0',
	backgroundSize:'16px 16px',
} as const

export function AteliLightbox() {
	const editor = useEditor()
	const result = useValue(lightbox)
	const root = useRef<HTMLDivElement>(null)
	const [mode, setMode] = useState<MaterialMode>('lit')
	useEffect(() => {
		if (!result) return
		setMode('lit')
		root.current?.focus()
	}, [result?.downloadUrl])
	if (!result) return null

	const close = () => lightbox.set(null)
	const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
		event.stopPropagation()
		if (event.target === event.currentTarget) close()
	}
	const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		event.stopPropagation()
		if (event.key === 'Escape') close()
	}
	const modes: Array<{ id: MaterialMode; label: string }> = [
		{ id:'lit', label:'Lit' },
		{ id:'wireframe', label:'Wireframe' },
		{ id:'normals', label:'Normals' },
		{ id:'unlit', label:'Unlit' },
	]

	return createPortal((
		<div ref={root} role="dialog" aria-modal="true" aria-label={`${result.title} lightbox`} tabIndex={-1} data-ateli-lightbox className="pointer-events-auto fixed inset-0 z-[999999] flex flex-col items-center justify-center gap-2 p-3 outline-none" style={{ background:'#0b0b0bcc' }} onPointerDown={pointerDown} onKeyDown={keyDown} onWheel={event => event.stopPropagation()}>
			<div className="ui-panel flex min-h-11 w-[92vw] items-center gap-2 px-3 py-1.5 text-xs">
				<div className="min-w-0 flex-1 truncate font-medium">{result.title}</div>
				<span className="ui-label">{result.kind}</span>
				{result.kind === 'mesh' ? <div className="flex items-center gap-1">{modes.map(item => <button key={item.id} type="button" className="ui-key h-7 px-2 text-[11px]" aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>)}</div> : null}
				<a className="ui-key inline-flex h-7 items-center gap-1.5 px-2 text-[11px] no-underline" href={result.downloadUrl} download><ExternalLink size={13} />Open file</a>
				<button type="button" className="ui-icon-button" aria-label="Close lightbox" onClick={close}><X /></button>
			</div>
			{result.kind === 'mesh' ? <MeshViewer key={result.downloadUrl} url={result.downloadUrl} mode={mode} /> : (
				<div className="inline-flex max-h-[86vh] max-w-[92vw] items-center justify-center overflow-hidden rounded-lg" style={checkerboard}>
					<img src={result.downloadUrl || result.previewUrl} alt={result.title} className="max-h-[86vh] max-w-[92vw] object-contain" />
				</div>
			)}
		</div>
	), editor.getContainer())
}
