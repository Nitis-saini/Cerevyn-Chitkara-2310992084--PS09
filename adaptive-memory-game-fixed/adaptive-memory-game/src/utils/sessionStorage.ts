import { DIFFICULTY_CONFIG, HISTORY_CONFIG } from '../config/gameConfig';
import type { Difficulty, SessionRecord } from '../types/game';

const isDifficulty = (v: unknown): v is Difficulty =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTY_CONFIG, v);

const isPositiveInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isNonNegativeInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** Fields added after v1 may be absent, but when present they must be valid. */
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);

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
    isDifficulty(r.nextDifficulty) &&
    optional(r.roundId, (v) => typeof v === 'string' && v.length > 0) &&
    optional(r.previousDifficulty, (v) => v === null || isDifficulty(v)) &&
    optional(r.gridColumns, isPositiveInt) &&
    optional(r.gridRows, isPositiveInt) &&
    optional(r.completedPairs, isNonNegativeInt) &&
    optional(r.mismatches, isNonNegativeInt) &&
    optional(r.reason, (v) => typeof v === 'string' && v.length <= 1000) &&
    optional(r.aiCoachSucceeded, (v) => typeof v === 'boolean') &&
    optional(r.decisionSource, (v) => v === 'pending' || v === 'gemini' || v === 'rules_fallback' || v === 'local_rules') &&
    optional(r.performance, (v) => v === 'strong' || v === 'good' || v === 'mixed' || v === 'weak')
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

/**
 * Merges a patch into the stored record with the given roundId (used to mark that the
 * AI coach answered after the round was already saved). Unknown IDs are ignored.
 */
export function updateRecord(
  roundId: string,
  patch: Partial<SessionRecord>,
  storage: Storage | null = getStorage(),
): SessionRecord[] {
  const records = loadHistory(storage);
  let changed = false;
  const updated = records.map((r) => {
    if (r.roundId !== roundId) return r;
    const patched = { ...r, ...patch, roundId };
    // A patch that would make the record invalid is ignored rather than losing the record.
    if (!isSessionRecord(patched)) return r;
    changed = true;
    return patched;
  });
  if (changed) saveHistory(updated, storage);
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

// ---------------------------------------------------------------------------------------
// Server-backed history support. The server database is authoritative; localStorage only
// keeps (a) the anonymous server-issued session ID and (b) a mirror of the history so the
// page can show something before the server answers or while it is unreachable.
// ---------------------------------------------------------------------------------------

const SERVER_SESSION_KEY = 'adaptive-memory-game:server-session:v1';
const SERVER_SESSION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** The anonymous session ID issued by the server, if one was saved and still looks valid. */
export function loadServerSessionId(storage: Storage | null = getStorage()): string | null {
  if (!storage) return null;
  try {
    const id = storage.getItem(SERVER_SESSION_KEY);
    return id !== null && SERVER_SESSION_PATTERN.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function saveServerSessionId(id: string, storage: Storage | null = getStorage()): void {
  if (!storage || !SERVER_SESSION_PATTERN.test(id)) return;
  try {
    storage.setItem(SERVER_SESSION_KEY, id);
  } catch {
    // ignore: the game works without persistence
  }
}

export function clearServerSessionId(storage: Storage | null = getStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SERVER_SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Replaces the whole local mirror (e.g. with the server's history). Invalid records are dropped. */
export function replaceHistory(
  records: SessionRecord[],
  storage: Storage | null = getStorage(),
): SessionRecord[] {
  const valid = records.filter(isSessionRecord).slice(-HISTORY_CONFIG.maxStoredResults);
  saveHistory(valid, storage);
  return valid;
}

/** Inserts a record, or replaces the stored one with the same roundId. Returns the new list. */
export function upsertRecord(
  record: SessionRecord,
  storage: Storage | null = getStorage(),
): SessionRecord[] {
  const current = loadHistory(storage);
  const index = record.roundId === undefined ? -1 : current.findIndex((r) => r.roundId === record.roundId);
  const next = index === -1 ? [...current, record] : current.map((r, i) => (i === index ? record : r));
  return replaceHistory(next, storage);
}
