import { Server } from 'node:http'
import { startHttpServer } from 'agentation-mcp'

const port = 4748
const host = '127.0.0.1'
const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`])
const appOrigin = 'tldraw-app://app'

function rejectBrowserRequest(request, response) {
	const origin = request.headers.origin
	const fetchSite = request.headers['sec-fetch-site']
	if (!allowedHosts.has(request.headers.host)
		|| (origin !== undefined && origin !== appOrigin)
		|| (origin === undefined && fetchSite !== undefined && fetchSite !== 'none' && fetchSite !== 'same-origin')) {
		response.writeHead(403, { 'Content-Type': 'application/json' })
		response.end(JSON.stringify({ error: 'Only the local tldraw app may access feedback.' }))
		return true
	}
	if ((request.method === 'POST' || request.method === 'PATCH')
		&& request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
		response.writeHead(415, { 'Content-Type': 'application/json' })
		response.end(JSON.stringify({ error: 'Expected application/json.' }))
		return true
	}
	return false
}

// agentation-mcp 1.2.0 exposes startHttpServer(port): void, with neither a host
// option nor a returned server. Constrain only its synchronous listen call;
// leave the package's routing, SSE, persistence, and public API untouched.
const originalListen = Server.prototype.listen
try {
	Server.prototype.listen = function (requestedPort, onListening) {
		if (requestedPort !== port) throw new Error('Unexpected Agentation listen call')
		const handlers = this.listeners('request')
		this.removeAllListeners('request')
		this.on('request', (request, response) => {
			if (rejectBrowserRequest(request, response)) return
			for (const handler of handlers) handler.call(this, request, response)
		})
		this.once('error', (error) => {
			console.error(`Feedback server failed: ${error.message}`)
			process.exit(1)
		})
		return originalListen.call(this, port, host, onListening)
	}
	startHttpServer(port)
} finally {
	Server.prototype.listen = originalListen
}
