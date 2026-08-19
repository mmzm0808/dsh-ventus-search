/**
 * Durable plugin state for dsh-ventus-search: master switch + per-engine health,
 * persisted as human-readable JSON with an atomic same-directory replace.
 * @module dsh-ventus-search/state
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

/** Health of one search engine as reported by the last search pass. */
export type EngineHealth = 'ok' | 'fail' | 'untested'

/** Per-engine health map kept in the state file. */
export interface EngineHealthMap {
  bing: EngineHealth
  so360: EngineHealth
  bilibili: EngineHealth
}

/** Whole plugin state: master switch, engine health, and last write time. */
export interface VentusState {
  enabled: boolean
  engines: EngineHealthMap
  updatedAt: string
}

/** Engine ids written back from the search provider. */
export type EngineId = 'bing' | 'so360' | 'bilibili'

/** Fresh default state (all engines untested). */
export function defaultState(enabled = true): VentusState {
  return {
    enabled,
    engines: { bing: 'untested', so360: 'untested', bilibili: 'untested' },
    updatedAt: new Date().toISOString(),
  }
}

function isHealth(value: unknown): value is EngineHealth {
  return value === 'ok' || value === 'fail' || value === 'untested'
}

/** Tolerant parse of an on-disk state file; unknown/malformed fields fall back to defaults. */
function parseState(raw: string, fallbackEnabled: boolean): VentusState {
  const fallback = defaultState(fallbackEnabled)
  try {
    const parsed = JSON.parse(raw) as Partial<VentusState>
    const engines = parsed.engines
    const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled
    return {
      enabled,
      engines: {
        bing: isHealth(engines?.bing) ? engines.bing : fallback.engines.bing,
        so360: isHealth(engines?.so360) ? engines.so360 : fallback.engines.so360,
        bilibili: isHealth(engines?.bilibili) ? engines.bilibili : fallback.engines.bilibili,
      },
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
    }
  } catch {
    // Corrupt JSON must not block plugin activation; start from defaults.
    return fallback
  }
}

/** In-memory state with atomic file persistence (temp file + fsync + rename). */
export class StateStore {
  private state: VentusState

  constructor(private readonly filePath: string) {
    this.state = defaultState(true)
  }

  /** Read the state file once (or initialize defaults) and keep it in memory. */
  load(fallbackEnabled = true): VentusState {
    if (!existsSync(this.filePath)) {
      this.state = defaultState(fallbackEnabled)
      this.persist()
      return this.get()
    }
    try {
      this.state = parseState(readFileSync(this.filePath, 'utf8'), fallbackEnabled)
    } catch {
      this.state = defaultState(fallbackEnabled)
    }
    return this.get()
  }

  /** Immutable snapshot of the current state. */
  get(): VentusState {
    return {
      enabled: this.state.enabled,
      engines: { ...this.state.engines },
      updatedAt: this.state.updatedAt,
    }
  }

  /** Flip the master switch and persist. */
  setEnabled(enabled: boolean): VentusState {
    this.state = { ...this.state, enabled, updatedAt: new Date().toISOString() }
    this.persist()
    return this.get()
  }

  /** Record one engine's health and persist. */
  setEngineHealth(engine: EngineId, health: EngineHealth): VentusState {
    this.state = {
      ...this.state,
      engines: { ...this.state.engines, [engine]: health },
      updatedAt: new Date().toISOString(),
    }
    this.persist()
    return this.get()
  }

  /** Atomic replace: write a temp file in the same directory, fsync, then rename. */
  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = this.filePath + '.tmp'
    const fd = openSync(temp, 'w')
    try {
      writeFileSync(fd, JSON.stringify(this.state, null, 2))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, this.filePath)
  }
}
