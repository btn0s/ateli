// The one local backend the document script talks to. launchd keeps this process alive (service.mjs); this process
// keeps its dependencies alive: the Agentation feedback server runs as a child here, and the imgen image service
// (its own launchd agent) is kicked on demand. New capabilities are new routes on this server.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import * as pty from 'node-pty'
import { WebSocketServer } from 'ws'
import { createAteliRouter } from './router.mjs'

function loadRepoEnvironment() {
	let contents
	try {
		contents = readFileSync(new URL('../.env', import.meta.url), 'utf8')
	} catch (error) {
		if (error.code === 'ENOENT') return
		throw error
	}
	for (const line of contents.split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
		if (!match || Object.hasOwn(process.env, match[1])) continue
		let value = match[2].trim()
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
		process.env[match[1]] = value
	}
}
loadRepoEnvironment()


// Agentation's server binds its own port (the MCP client and the launcher point at it); supervise it rather than embed it.
const feedback = { child: null, restarts: 0, stopping: false }
function startFeedback() {
	const child = spawn(process.execPath, [new URL('./feedback-server.mjs', import.meta.url).pathname], { stdio: 'inherit' })
	feedback.child = child
	child.on('exit', (code, signal) => {
		feedback.child = null
		if (feedback.stopping) return
		feedback.restarts += 1
		console.error(`Feedback server exited (${signal || code}); restarting in 2s.`)
		setTimeout(startFeedback, 2000).unref()
	})
}
startFeedback()

const host = '127.0.0.1'
const port = 7237
const self = `http://${host}:${port}`
const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`])
const allowedOrigins = new Set(['tldraw-app://app', 'http://127.0.0.1:7236', 'http://localhost:7236', self, `http://localhost:${port}`])
const maxBodyBytes = 64 * 1024
const maxOutputBytes = 48 * 1024 * 1024
const maxTerminals = 8
const timeoutSeconds = 600
const terminals = new Set()
const jobs = new Map()
const ateliRouter = createAteliRouter({
	blenderPath: '/opt/homebrew/bin/blender',
	stagingRoot: '/Users/btnorris/dev/games/last-light/.scratch/ateli',
	allowedSourceRoots: ['/Users/btnorris/dev/games/last-light/client/public/character-experiments'],
	exportRoots: { 'character-experiments': '/Users/btnorris/dev/games/last-light/client/public/character-experiments' },
})


// The terminal is its own page: xterm.js served straight from node_modules, one WebSocket per shell.
// Binary frames carry keystrokes; text frames carry JSON control messages ({ resize: [cols, rows] }).
const require = createRequire(import.meta.url)
const terminalAssets = {
	'/terminal/xterm.mjs': { path: require.resolve('@xterm/xterm/lib/xterm.mjs'), type: 'text/javascript' },
	'/terminal/addon-fit.mjs': { path: require.resolve('@xterm/addon-fit/lib/addon-fit.mjs'), type: 'text/javascript' },
	'/terminal/xterm.css': { path: require.resolve('@xterm/xterm/css/xterm.css'), type: 'text/css' },
	'/terminal/app.js': { path: new URL('./terminal-page.js', import.meta.url), type: 'text/javascript' },
	'/terminal/': { path: new URL('./terminal-page.html', import.meta.url), type: 'text/html' },
}
const terminalSockets = new WebSocketServer({ noServer: true, maxPayload: maxBodyBytes })

function attachTerminal(socket, url) {
	if (terminals.size >= maxTerminals) {
		socket.close(1013, 'Too many terminal sessions are open.')
		return
	}
	const cols = Number(url.searchParams.get('cols')) || 80
	const rows = Number(url.searchParams.get('rows')) || 24
	const shell = process.env.SHELL || '/bin/zsh'
	const child = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' } })
	terminals.add(child)
	child.onData(data => { if (socket.readyState === socket.OPEN) socket.send(data) })
	child.onExit(({ exitCode }) => {
		terminals.delete(child)
		if (socket.readyState === socket.OPEN) socket.close(1000, `Shell exited with code ${exitCode}.`)
	})
	socket.on('message', (data, isBinary) => {
		if (isBinary) { child.write(data.toString('utf8')); return }
		const message = parseJson(data.toString('utf8'))
		const [nextCols, nextRows] = message?.resize ?? []
		if (Number.isInteger(nextCols) && Number.isInteger(nextRows) && nextCols >= 2 && nextCols <= 500 && nextRows >= 1 && nextRows <= 300) child.resize(nextCols, nextRows)
	})
	socket.on('close', () => { if (terminals.delete(child)) child.kill() })
	socket.on('error', () => socket.terminate())
}

class BackendError extends Error {
	constructor(status, code, message) {
		super(message)
		this.status = status
		this.code = code
	}
}

function reply(response, status, body) {
	if (response.destroyed || response.writableEnded) return
	response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
	response.end(JSON.stringify(body))
}

function readJson(request) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let bytes = 0
		let overflow = false
		request.on('data', (chunk) => {
			if (overflow) return
			bytes += chunk.length
			if (bytes > maxBodyBytes) {
				overflow = true
				chunks.length = 0
				reject(new BackendError(413, 'request_too_large', 'The image prompt is too large.'))
			} else chunks.push(chunk)
		})
		request.on('end', () => {
			if (overflow) return
			try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
			catch { reject(new BackendError(400, 'invalid_json', 'Send a JSON object with prompt, width, height, and requestId.')) }
		})
		request.on('error', reject)
		request.on('aborted', () => reject(new BackendError(400, 'request_aborted', 'The request was interrupted.')))
	})
}

function validateRequest(body) {
	if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => !['prompt', 'width', 'height', 'requestId'].includes(key))) {
		throw new BackendError(400, 'invalid_request', 'Only prompt, width, height, and requestId are accepted.')
	}
	if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 8000) {
		throw new BackendError(400, 'invalid_prompt', 'Enter a prompt of 1–8000 characters.')
	}
	if (![body.width, body.height].every((value) => Number.isInteger(value) && value >= 64 && value <= 4096)) {
		throw new BackendError(400, 'invalid_dimensions', 'Image dimensions must be integers between 64 and 4096 pixels.')
	}
	if (typeof body.requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.requestId)) {
		throw new BackendError(400, 'invalid_request_id', 'A UUID requestId is required.')
	}
}

function parseJson(value) {
	try { return JSON.parse(value) } catch { return null }
}

const imgenUrl = 'http://127.0.0.1:8765'
// The image service is its own launchd agent (dev/local-image). It restarts on failure but stays down after a clean
// exit, so a generation request that finds it gone kicks it and waits rather than failing.
const imgenAgent = `gui/${process.getuid()}/com.local-image.service`
async function imgenHealthy() {
	try { return (await fetch(`${imgenUrl}/health`, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}
async function ensureImgen() {
	if (await imgenHealthy()) return
	try { execFileSync('launchctl', ['kickstart', imgenAgent], { stdio: 'ignore' }) } catch { /* not installed: the health wait below reports it */ }
	for (let attempt = 0; attempt < 20; attempt++) {
		await new Promise(resolve => setTimeout(resolve, 500))
		if (await imgenHealthy()) return
	}
	throw new BackendError(503, 'imgen_unavailable', 'The image service is not running and did not start (launchctl kickstart com.local-image.service).')
}

function generate({ prompt, width, height }) {
	// The renderer never controls the executable, service, model, output path, or CLI flags.
	const child = spawn('imgen', [
		'--url', imgenUrl, 'generate', '--dimensions', `${width}x${height}`,
		'--format', 'png', '--count', '1', '--base64', '--timeout', String(timeoutSeconds), '--', prompt,
	], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
	const promise = new Promise((resolve, reject) => {
		const chunks = []
		let bytes = 0
		let stderr = ''
		let failure = null
		const stop = (error) => {
			if (failure) return
			failure = error
			child.kill('SIGKILL')
		}
		const timer = setTimeout(() => stop(new BackendError(504, 'generation_timeout', 'Imgen timed out. Check imgen status before retrying; its service job may still be running.')), (timeoutSeconds + 15) * 1000)
		timer.unref()
		child.stdout.on('data', (chunk) => {
			bytes += chunk.length
			if (bytes > maxOutputBytes) {
				stop(new BackendError(502, 'image_too_large', 'The generated image exceeds the bridge response limit.'))
			} else if (!failure) chunks.push(chunk)
		})
		child.stderr.on('data', (chunk) => {
			if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8')
		})
		child.on('error', (error) => {
			clearTimeout(timer)
			reject(new BackendError(503, 'imgen_unavailable', error.code === 'ENOENT' ? 'The imgen executable is not on the bridge PATH.' : `Cannot start imgen: ${error.message}`))
		})
		child.on('close', (code) => {
			clearTimeout(timer)
			if (failure) { reject(failure); return }
			const result = parseJson(Buffer.concat(chunks).toString('utf8'))
			if (code !== 0 || result?.status !== 'completed') {
				const error = result?.error || parseJson(stderr)?.error
				reject(new BackendError(502, error?.code || 'generation_failed', error?.message || `Imgen exited without an image (${code ?? 'interrupted'}).`))
				return
			}
			const image = result.outputs?.[0]
			if (image?.mime_type !== 'image/png' || typeof image.data_base64 !== 'string' || !image.data_base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data_base64) || image.width !== width || image.height !== height) {
				reject(new BackendError(502, 'invalid_image', 'Imgen returned an invalid image payload.'))
				return
			}
			resolve({ dataUrl: `data:image/png;base64,${image.data_base64}`, width: image.width, height: image.height })
		})
	})
	return { child, promise }
}

const server = createServer(async (request, response) => {
	try {
		if (!allowedHosts.has(request.headers.host)) throw new BackendError(403, 'forbidden_host', 'Only the local bridge host is allowed.')
		const origin = request.headers.origin
		if (origin !== undefined && !allowedOrigins.has(origin)) throw new BackendError(403, 'forbidden_origin', 'This origin cannot use the local bridge.')
		if (origin) {
			response.setHeader('Access-Control-Allow-Origin', origin)
			response.setHeader('Vary', 'Origin')
		}
		const url = new URL(request.url, `http://${host}:${port}`)
		if (url.pathname.startsWith('/ateli/')) {
			const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(request.method || '')
			if (stateChanging && !origin) throw new BackendError(403, 'origin_required', 'State-changing Ateli requests require an allowed Origin header.')
			if (request.method === 'OPTIONS') {
				const requestedMethod = request.headers['access-control-request-method']
				const requestedHeaders = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
				if (!origin || !['GET', 'POST', 'DELETE'].includes(requestedMethod) || requestedHeaders.some(value => value !== 'content-type')) {
					throw new BackendError(403, 'forbidden_preflight', 'Only JSON or multipart Ateli requests are allowed.')
				}
				response.writeHead(204, {
					'Access-Control-Allow-Methods': 'GET, POST, DELETE',
					'Access-Control-Allow-Headers': 'Content-Type',
					'Access-Control-Allow-Private-Network': 'true',
					'Access-Control-Max-Age': '600',
				})
				response.end()
				return
			}
			if (await ateliRouter.handle(request, response, url)) return
		}
		if (request.method === 'GET' && terminalAssets[url.pathname]) {
			const asset = terminalAssets[url.pathname]
			response.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
			response.end(readFileSync(asset.path))
			return
		}
		if (request.method === 'GET' && request.url === '/health') {
			reply(response, 200, { status: 'ok', feedback: feedback.child ? 'running' : 'restarting', imgen: await imgenHealthy() ? 'running' : 'stopped', ateli: await ateliRouter.health(), activeJobs: jobs.size, terminals: terminals.size })
			return
		}
		if (request.url !== '/generate') throw new BackendError(404, 'not_found', 'Endpoint not found.')
		if (!origin) throw new BackendError(403, 'origin_required', 'Generation requires an allowed Origin header.')
		if (request.method === 'OPTIONS') {
			const headers = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean)
			if (request.headers['access-control-request-method'] !== 'POST' || headers.some((value) => value !== 'content-type')) {
				throw new BackendError(403, 'forbidden_preflight', 'Only JSON generation requests are allowed.')
			}
			response.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' })
			response.end()
			return
		}
		if (request.method !== 'POST') throw new BackendError(405, 'method_not_allowed', 'Use POST to generate an image.')
		if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) {
			throw new BackendError(415, 'json_required', 'Content-Type must be application/json.')
		}
		if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new BackendError(415, 'unsupported_encoding', 'Compressed request bodies are not accepted.')
		if (Number(request.headers['content-length']) > maxBodyBytes) throw new BackendError(413, 'request_too_large', 'The image prompt is too large.')
		const body = await readJson(request)
		validateRequest(body)
		if (response.destroyed) return
		if (jobs.has(body.requestId)) throw new BackendError(409, 'duplicate_request', 'This image request is already running.')
		if (jobs.size) throw new BackendError(409, 'generation_busy', 'Imgen is already generating an image. Wait for it to finish, then try again.')
		await ensureImgen()
		const job = generate(body)
		jobs.set(body.requestId, job)
		try {
			const result = await job.promise
			reply(response, 200, result)
		} finally {
			jobs.delete(body.requestId)
		}
	} catch (error) {
		request.resume()
		reply(response, error instanceof BackendError ? error.status : 500, { error: { code: error instanceof BackendError ? error.code : 'backend_error', message: error instanceof BackendError ? error.message : 'The local backend could not complete the request.' } })
	}
})


server.on('upgrade', (request, socket, head) => {
	const origin = request.headers.origin
	const url = new URL(request.url, self)
	if (!allowedHosts.has(request.headers.host) || !allowedOrigins.has(origin) || url.pathname !== '/terminal/ws') {
		socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
		socket.destroy()
		return
	}
	terminalSockets.handleUpgrade(request, socket, head, ws => attachTerminal(ws, url))
})
server.requestTimeout = 30_000
server.headersTimeout = 10_000
server.on('error', (error) => { console.error(`Local backend: ${error.message}`); process.exitCode = 1 })
server.listen(port, host, () => console.log(`Local backend ready at ${self} (imgen, terminal; feedback on 4748)`))

async function shutdown() {
	feedback.stopping = true
	feedback.child?.kill('SIGTERM')
	server.close()
	server.closeAllConnections()
	for (const child of terminals) child.kill()
	for (const { child } of jobs.values()) child.kill('SIGTERM')
	await ateliRouter.close()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
