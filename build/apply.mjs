import { readFile, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { build } from 'esbuild'
import { buildOptions } from './build.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = process.argv[2] ? resolve(process.argv[2]) : null
const appData = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support')
	: process.platform === 'win32' ? process.env.APPDATA
	: process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
const { port, token } = JSON.parse(await readFile(join(appData, 'tldraw/server.json'), 'utf8'))

async function request(path, body) {
	const response = await fetch(`http://localhost:${port}${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const data = await response.json()
	if (!response.ok || !data.success) throw new Error(JSON.stringify(data))
	return data.result
}

const docs = (await request('/api/search', { code: 'return await api.getDocs()' }))
	.filter((doc) => doc.ownership === 'local' && (target ? doc.filePath === target : doc.filePath.startsWith(root + '/')))
if (!docs.length) throw new Error(target ? `Open ${target} in tldraw offline first.` : `No documents from ${root} are open in tldraw offline.`)
// Keep the app's own React/tldraw instances; bundle npm-only dependencies such as Agentation.
const bundle = await build({ ...buildOptions, write: false })

async function apply(doc) {
	const base = `/api/doc/${doc.id}`
	const workspace = await request(`${base}/script-workspace`, {})
	await writeFile(join(workspace.scriptDir, 'config.js'), bundle.outputFiles[0].contents)
	// This standalone file was installed before config.js became a self-contained bundle.
	await rm(join(workspace.scriptDir, 'browser-shape.js'), { force: true })
	for (let attempt = 0; attempt < 40; attempt++) {
		await setTimeout(250)
		const status = await request(`${base}/script-status`)
		if (status.state === 'error') throw new Error(JSON.stringify(status))
		if (status.state !== 'applied') continue
		try {
			await request(`${base}/exec`, { code: 'await helpers.saveDoc()' })
		} catch (error) {
			// The watcher can finish before config.js's new editor has mounted or before the replacement editor's sync connection is ready.
			if (error.message.includes('"error":"Editor not mounted"') || error.message.includes('"error":"Invoke timed out"')) continue
			throw error
		}
		console.log(`Personal canvas tools installed and saved: ${doc.filePath}`)
		return
	}
	throw new Error(`${doc.filePath}: script watcher did not finish within 10 seconds. Inspect script-status before retrying.`)
}

const results = await Promise.allSettled(docs.map(apply))
const failures = results.filter((result) => result.status === 'rejected')
for (const failure of failures) console.error(failure.reason.message)
process.exit(failures.length ? 1 : 0)
