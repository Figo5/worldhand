// Versioned localStorage save system. No engine logic here.
import type { GameState } from '../engine/worldhand'
import { SAVE_VERSION } from '../engine/worldhand'

const KEY = 'worldhand.save'
export const CURRENT_VERSION = SAVE_VERSION

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

function migrate(state: any): GameState | null {
  // v1 (old 8-epoch contract) is incompatible with the v2 three-epoch core:
  // discard stale v1 saves rather than guess a migration.
  if (state?.version === 1) return null
  return null
}

export function hasSave(): boolean {
  return loadGame() !== null
}