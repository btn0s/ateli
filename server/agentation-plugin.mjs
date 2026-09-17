import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const packageDirectory = dirname(dirname(require.resolve('agentation')))
const entryPath = join(packageDirectory, 'dist', 'index.mjs')

const replacements = [
	[
		'const pathname = typeof window !== "undefined" ? window.location.pathname : "/";',
		'const pathname = typeof window !== "undefined" ? window.location.pathname + window.location.hash.split("?")[0] : "/";',
	],
	[
		'const allAnnotations = loadAllAnnotations();',
		'const allAnnotations = new Map([[pathname, loadAnnotations(pathname)]]);',
	],
]

// Agentation keys annotations, sessions, and layout state by pathname alone.
// tldraw routes documents in the hash; adapt just this pinned browser module,
// and prevent its initial bulk sync from importing other documents' caches.
export const agentationPlugin = {
	name: 'tldraw-agentation-document-scope',
	setup(build) {
		build.onResolve({ filter: /^agentation$/ }, () => ({ path: entryPath }))
		build.onLoad({ filter: /[/\\]agentation[/\\]dist[/\\]index\.mjs$/ }, async ({ path }) => {
			if (path !== entryPath) throw new Error('Unexpected Agentation module path')
			const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
			if (manifest.version !== '3.0.2') {
				throw new Error(`Agentation document adapter requires 3.0.2; found ${manifest.version}`)
			}
			let contents = await readFile(path, 'utf8')
			for (const [before, after] of replacements) {
				const index = contents.indexOf(before)
				if (index === -1 || contents.indexOf(before, index + before.length) !== -1) {
					throw new Error(`Agentation document adapter expected exactly one occurrence of: ${before}`)
				}
				contents = contents.replace(before, after)
			}
			return { contents, loader: 'js', resolveDir: dirname(path) }
		})
	},
}
