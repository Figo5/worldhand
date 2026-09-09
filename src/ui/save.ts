// Versioned localStorage save system. No engine logic here.
import type { GameState } from '../engine/worldhand'

const KEY = 'worldhand.save'
export const CURRENT_VERSION = 1

interface SaveEnvelope {
  version: number
  savedAt: string
  state: GameState
}

export function saveGame(state: GameState): void {
  const env: SaveEnvelope = { version: CURRENT_VERSION, savedAt: new Date().toISOString(), state }
  localStorage.setItem(KEY, JSON.stringify(env))
}

export function loadGame(): GameState | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const env = JSON.parse(raw) as SaveEnvelope
    if (env.version > CURRENT_VERSION) return null // forward-only
    if (env.version === CURRENT_VERSION) return env.state
    return migrate(env.state)
  } catch {
    return null
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY)
}

function migrate(state: GameState): GameState {
  return state // v1 is current; chain future migrations here
}

export function hasSave(): boolean {
  return loadGame() !== null
}