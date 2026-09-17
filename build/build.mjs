import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { agentationPlugin } from '../server/agentation-plugin.mjs'
import { tailwindPlugin } from './tailwind-plugin.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mod = join(root, 'mod')
const skin = join(mod, 'skin')


// One document-script bundle. React, its JSX runtime, and tldraw stay external so the script binds to the app's own instances.
// `@/` maps to mod/skin/ (shadcn's convention; tsconfig carries the same alias for the type checker).
export const buildOptions = {
	entryPoints: [join(mod, 'config.tsx')],
	bundle: true,
	format: 'esm',
	alias: { '@': skin },
	external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'tldraw'],
	plugins: [agentationPlugin, tailwindPlugin({ sources: [mod] })],
	define: { 'process.env.NODE_ENV': '"production"' },
	loader: { '.png': 'dataurl' },
}

// `node build/build.mjs`: bundle without an open document, as a syntax and import check.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = await build({ ...buildOptions, write: false, logLevel: 'warning' })
	console.log(`bundle ok: mod/config.tsx → ${result.outputFiles[0].contents.length} bytes`)
}
