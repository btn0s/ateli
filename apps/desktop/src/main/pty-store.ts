import type { IPty } from "node-pty"
import { execSync } from "node:child_process"

// Maps sessionKey (tmux session name) -> node-pty process attached to it
export const ptys = new Map<string, IPty>()

const SESSION_PREFIX = "ateli-"

export function tmuxSessionName(sessionKey: string): string {
  return `${SESSION_PREFIX}${sessionKey}`
}

export function createTmuxSession(sessionKey: string, cwd: string): void {
  const name = tmuxSessionName(sessionKey)
  execSync(`tmux new-session -d -s ${name} -c ${JSON.stringify(cwd)}`, {
    stdio: "ignore",
  })
}

export function readTmuxPane(sessionKey: string): string {
  const name = tmuxSessionName(sessionKey)
  try {
    return execSync(`tmux capture-pane -t ${name} -p -S -200`, {
      encoding: "utf-8",
      timeout: 3000,
    })
  } catch {
    return ""
  }
}

export function killTmuxSession(sessionKey: string): void {
  const name = tmuxSessionName(sessionKey)
  try {
    execSync(`tmux kill-session -t ${name}`, { stdio: "ignore" })
  } catch {
    // already dead
  }
}

export function listTmuxSessions(): string[] {
  try {
    const output = execSync(
      `tmux list-sessions -F "#{session_name}" 2>/dev/null`,
      { encoding: "utf-8" },
    )
    return output
      .trim()
      .split("\n")
      .filter((s) => s.startsWith(SESSION_PREFIX))
      .map((s) => s.slice(SESSION_PREFIX.length))
  } catch {
    return []
  }
}

export function sendTmuxKeys(sessionKey: string, keys: string): void {
  const name = tmuxSessionName(sessionKey)
  execSync(`tmux send-keys -t ${name} ${JSON.stringify(keys)}`, {
    stdio: "ignore",
  })
}

export function sendTmuxCommand(sessionKey: string, command: string): void {
  const name = tmuxSessionName(sessionKey)
  execSync(
    `tmux send-keys -t ${name} ${JSON.stringify(command)} Enter`,
    { stdio: "ignore" },
  )
}
