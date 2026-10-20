import { DIFFICULTY_CONFIG } from '../src/config/gameConfig';
import type { RoundStats, Difficulty, RoundSubmission } from '../src/types/game';

export class ValidationError extends Error {}

const isDifficulty = (v: unknown): v is Difficulty =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTY_CONFIG, v);

const int = (v: unknown, name: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ValidationError(`${name} must be an integer from ${min} to ${max}`);
  }
  return v;
};

const KEYS = [
  'difficulty',
  'gridColumns',
  'gridRows',
  'pairCount',
  'completedPairs',
  'moves',
  'mismatches',
  'elapsedSeconds',
] as const;

export function parseStats(value: unknown, label: string): RoundStats {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`);
  }
  const v = value as Record<string, unknown>;
  const extra = Object.keys(v).filter((k) => !(KEYS as readonly string[]).includes(k));
  if (extra.length > 0) throw new ValidationError(`${label} has unexpected fields`);
  if (!isDifficulty(v.difficulty)) throw new ValidationError(`${label}.difficulty is not supported`);

  const stats: RoundStats = {
    difficulty: v.difficulty,
    gridColumns: int(v.gridColumns, `${label}.gridColumns`, 1, 12),
    gridRows: int(v.gridRows, `${label}.gridRows`, 1, 12),
    pairCount: int(v.pairCount, `${label}.pairCount`, 1, 50),
    completedPairs: int(v.completedPairs, `${label}.completedPairs`, 0, 50),
    moves: int(v.moves, `${label}.moves`, 0, 1000),
    mismatches: int(v.mismatches, `${label}.mismatches`, 0, 1000),
    elapsedSeconds: int(v.elapsedSeconds, `${label}.elapsedSeconds`, 0, 86_400),
  };

  // Cross-field consistency: reject impossible statistics instead of coaching on them.
  const cfg = DIFFICULTY_CONFIG[stats.difficulty];
  if (
    stats.gridColumns !== cfg.columns ||
    stats.gridRows !== cfg.rows ||
    stats.pairCount !== cfg.pairCount
  ) {
    throw new ValidationError(`${label} grid does not match the ${cfg.label} difficulty`);
  }
  if (stats.completedPairs > stats.pairCount) {
    throw new ValidationError(`${label}.completedPairs exceeds pairCount`);
  }
  if (stats.moves !== stats.completedPairs + stats.mismatches) {
    throw new ValidationError(`${label}.moves must equal completedPairs + mismatches`);
  }
  return stats;
}


/** Anonymous IDs are server-issued UUIDs, but older/fallback client IDs use a safe charset too. */
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const isValidId = (v: unknown): v is string => typeof v === 'string' && ID_PATTERN.test(v);

/**
 * Strictly validates a completed-round submission: the same numeric statistics and
 * consistency rules as the coach request, plus the idempotency key and `completed: true`.
 * No free text is accepted anywhere.
 */
export function parseRoundSubmission(body: unknown): RoundSubmission {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const { clientRoundId, completed, ...statFields } = b;
  if (!isValidId(clientRoundId)) throw new ValidationError('clientRoundId is invalid');
  if (completed !== true) throw new ValidationError('Only completed rounds can be submitted');

  const stats = parseStats(statFields, 'round');
  if (stats.completedPairs !== stats.pairCount) {
    throw new ValidationError('round must have every pair matched');
  }
  return { ...stats, clientRoundId, completed: true };
}
