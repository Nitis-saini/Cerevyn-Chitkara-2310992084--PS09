import { DIFFICULTY_CONFIG, HISTORY_CONFIG } from '../config/gameConfig';
import type { Difficulty, SessionRecord } from '../types/game';

const isDifficulty = (v: unknown): v is Difficulty =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTY_CONFIG, v);

/** Runtime validation for anything read back from localStorage. */
export function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    r.sessionId.length > 0 &&
    typeof r.completedAt === 'string' &&
    !Number.isNaN(Date.parse(r.completedAt)) &&
    typeof r.moves === 'number' &&
    Number.isInteger(r.moves) &&
    r.moves > 0 &&
    typeof r.elapsedSeconds === 'number' &&
    Number.isFinite(r.elapsedSeconds) &&
    r.elapsedSeconds >= 0 &&
    isDifficulty(r.difficulty) &&
    isDifficulty(r.nextDifficulty)
  );
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // e.g. storage blocked by browser privacy settings
  }
}

/** Anonymous random ID, created once per page load. Not stored or linked to a person. */
export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Loads valid records (oldest first). Never throws; bad data yields an empty or filtered list. */
export function loadHistory(storage: Storage | null = getStorage()): SessionRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_CONFIG.storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSessionRecord);
  } catch {
    return [];
  }
}

function saveHistory(records: SessionRecord[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(HISTORY_CONFIG.storageKey, JSON.stringify(records));
  } catch {
    // Quota exceeded or storage unavailable: the game keeps working without persistence.
  }
}

/** Appends a record (keeping only the newest N) and returns the updated list. */
export function addRecord(
  record: SessionRecord,
  storage: Storage | null = getStorage(),
): SessionRecord[] {
  const updated = [...loadHistory(storage), record].slice(-HISTORY_CONFIG.maxStoredResults);
  saveHistory(updated, storage);
  return updated;
}

export function clearHistory(storage: Storage | null = getStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(HISTORY_CONFIG.storageKey);
  } catch {
    // ignore
  }
}

export function getBestResults(records: SessionRecord[]): {
  bestSeconds: number | null;
  bestMoves: number | null;
} {
  if (records.length === 0) return { bestSeconds: null, bestMoves: null };
  return {
    bestSeconds: Math.min(...records.map((r) => r.elapsedSeconds)),
    bestMoves: Math.min(...records.map((r) => r.moves)),
  };
}
