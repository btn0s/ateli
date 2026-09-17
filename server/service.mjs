// Keep the local services (feedback + bridge) always on: a per-user launchd agent that starts at login and
// restarts them whenever they exit. `npm run service install|uninstall|status|restart|logs`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('The always-on service uses launchd and is macOS-only. Run `npm start` instead.')

const root = dirname(fileURLToPath(import.meta.url))
const label = 'com.tldraw-offline.services'
const plistPath = join(homedir(), 'Library/LaunchAgents', `${label}.plist`)
const logPath = join(homedir(), 'Library/Logs', 'tldraw-offline-services.log')
const domain = `gui/${process.getuid()}`
const command = process.argv[2] ?? 'status'

const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
// launchd gives agents a minimal PATH; imgen and the shells the terminal spawns want the one this install ran with.
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${label}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${escape(process.execPath)}</string>
		<string>${escape(join(root, 'backend.mjs'))}</string>
	</array>
	<key>WorkingDirectory</key><string>${escape(root)}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key><string>${escape(process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin')}</string>
		<key>HOME</key><string>${escape(homedir())}</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>2</integer>
	<key>StandardOutPath</key><string>${escape(logPath)}</string>
	<key>StandardErrorPath</key><string>${escape(logPath)}</string>
</dict>
</plist>
`

function launchctl(...args) {
	return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function bootout() {
	try { launchctl('bootout', `${domain}/${label}`) } catch { /* not loaded */ }
}

// The image service (imgen) is a separate always-on agent from dev/local-image; the bridge kickstarts it on demand.
const agents = { [label]: 'backend (+ feedback child)', 'com.local-image.service': 'image service (imgen)' }
function status() {
	for (const [name, role] of Object.entries(agents)) {
		try {
			const pid = launchctl('print', `${domain}/${name}`).match(/^\s*pid = (\d+)/m)?.[1]
			console.log(`${name} (${role}): ${pid ? `running (pid ${pid})` : 'loaded, not running'}`)
		} catch {
			console.log(`${name} (${role}): not installed${name === label ? '' : ' — run dev/local-image/scripts/install-launchd.sh'}`)
		}
	}
}

switch (command) {
	case 'install': {
		mkdirSync(dirname(plistPath), { recursive: true })
		writeFileSync(plistPath, plist)
		bootout()
		launchctl('bootstrap', domain, plistPath)
		console.log(`Installed ${plistPath}\nLogs: ${logPath}`)
		status()
		break
	}
	case 'uninstall': {
		bootout()
		rmSync(plistPath, { force: true })
		console.log(`Removed ${label}`)
		break
	}
	case 'restart': {
		launchctl('kickstart', '-k', `${domain}/${label}`)
		status()
		break
	}
	case 'logs': {
		execFileSync('tail', ['-n', '60', logPath], { stdio: 'inherit' })
		break
	}
	case 'status': {
		status()
		break
	}
	default:
		throw new Error(`Unknown command "${command}". Use install, uninstall, status, restart, or logs.`)
}
