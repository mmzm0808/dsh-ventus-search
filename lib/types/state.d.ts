/**
 * Durable plugin state for dsh-ventus-search: master switch + per-engine health,
 * persisted as human-readable JSON with an atomic same-directory replace.
 * @module dsh-ventus-search/state
 */
/** Health of one search engine as reported by the last search pass. */
export type EngineHealth = 'ok' | 'fail' | 'untested';
/** Per-engine health map kept in the state file. */
export interface EngineHealthMap {
    bing: EngineHealth;
    so360: EngineHealth;
    bilibili: EngineHealth;
}
/** Whole plugin state: master switch, engine health, and last write time. */
export interface VentusState {
    enabled: boolean;
    engines: EngineHealthMap;
    updatedAt: string;
}
/** Engine ids written back from the search provider. */
export type EngineId = 'bing' | 'so360' | 'bilibili';
/** Fresh default state (all engines untested). */
export declare function defaultState(enabled?: boolean): VentusState;
/** In-memory state with atomic file persistence (temp file + fsync + rename). */
export declare class StateStore {
    private readonly filePath;
    private state;
    constructor(filePath: string);
    /** Read the state file once (or initialize defaults) and keep it in memory. */
    load(fallbackEnabled?: boolean): VentusState;
    /** Immutable snapshot of the current state. */
    get(): VentusState;
    /** Flip the master switch and persist. */
    setEnabled(enabled: boolean): VentusState;
    /** Record one engine's health and persist. */
    setEngineHealth(engine: EngineId, health: EngineHealth): VentusState;
    /** Atomic replace: write a temp file in the same directory, fsync, then rename. */
    private persist;
}
