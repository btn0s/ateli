import { Terminal } from '/terminal/xterm.mjs'
import { FitAddon } from '/terminal/addon-fit.mjs'

const encoder = new TextEncoder()
const term = new Terminal({
	cursorBlink: true,
	fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
	fontSize: 13,
	lineHeight: 1.2,
	scrollback: 5000,
	theme: { background: '#171817', foreground: '#f3f1e9', cursor: '#f3f1e9', selectionBackground: '#607a554d', black: '#171817', brightBlack: '#747873', green: '#9acb75', brightGreen: '#b5e394' },
})
const fit = new FitAddon()
term.loadAddon(fit)
term.open(document.getElementById('terminal'))
fit.fit()

// The backend is kept alive by launchd; if it is mid-restart (or the shell exited), keep trying until a socket opens.
let socket = null
let attempts = 0
function connect() {
	socket = new WebSocket(`ws://${location.host}/terminal/ws?cols=${term.cols}&rows=${term.rows}`)
	socket.binaryType = 'arraybuffer'
	socket.onopen = () => {
		if (attempts) term.write('\r\n\x1b[90mReconnected.\x1b[0m\r\n')
		attempts = 0
	}
	socket.onmessage = (event) => term.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data))
	socket.onclose = (event) => {
		if (attempts === 0) term.write(`\r\n\x1b[90m${event.reason || 'Local backend unavailable.'} Reconnecting…\x1b[0m`)
		attempts += 1
		setTimeout(connect, Math.min(5000, 500 * attempts))
	}
}
connect()

term.onData((data) => { if (socket.readyState === WebSocket.OPEN) socket.send(encoder.encode(data)) })
new ResizeObserver(() => {
	fit.fit()
	if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ resize: [term.cols, term.rows] }))
}).observe(document.getElementById('terminal'))

// The canvas hands focus to the iframe element; take it into the terminal.
window.addEventListener('focus', () => term.focus())
term.focus()
