import { DIFFICULTY_CONFIG, DIFFICULTY_ORDER, PERFORMANCE_POLICY } from '../config/gameConfig';
import type { RoundStats, Difficulty, PerformanceBand, PerformanceRating } from '../types/game';

/**
 * Pure, dependency-free policy helpers. The backend uses them to compute objective metrics,
 * to bound what Gemini may choose and to validate its answer; the browser uses
 * `fallbackDecision` only for the explicitly labelled (non-AI) fallback. Thresholds live in
 * PERFORMANCE_POLICY and DIFFICULTY_CONFIG.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RoundMetrics {
  movesPerPair: number;
  secondsPerPair: number;
  mismatchRate: number;
  /** moves / the level's maxMoves; above 1 means over budget. */
  moveBudgetUsed: number;
  /** active seconds / the level's maxSeconds; above 1 means over budget. */
  timeBudgetUsed: number;
}

/** Objective statistics, computed in code so the model never has to infer or invent them. */
export function computeMetrics(stats: RoundStats): RoundMetrics {
  const { targets } = DIFFICULTY_CONFIG[stats.difficulty];
  return {
    movesPerPair: round2(stats.moves / stats.pairCount),
    secondsPerPair: round2(stats.elapsedSeconds / stats.pairCount),
    mismatchRate: stats.moves === 0 ? 0 : round2(stats.mismatches / stats.moves),
    moveBudgetUsed: round2(stats.moves / targets.maxMoves),
    timeBudgetUsed: round2(stats.elapsedSeconds / targets.maxSeconds),
  };
}

/** Classifies a round against its own level's budget. See PERFORMANCE_POLICY for the rationale. */
export function classifyRound(stats: RoundStats): PerformanceBand {
  const { targets } = DIFFICULTY_CONFIG[stats.difficulty];
  if (stats.moves > targets.maxMoves || stats.elapsedSeconds > targets.maxSeconds) return 'weak';

  const { strongBudgetRatio, strongMaxMismatchRate } = PERFORMANCE_POLICY;
  const mismatchRate = stats.moves === 0 ? 0 : stats.mismatches / stats.moves;
  const comfortable =
    stats.moves <= targets.maxMoves * strongBudgetRatio &&
    stats.elapsedSeconds <= targets.maxSeconds * strongBudgetRatio &&
    mismatchRate <= strongMaxMismatchRate;
  return comfortable ? 'strong' : 'mixed';
}

const rank = (d: Difficulty) => DIFFICULTY_ORDER.indexOf(d);

/** One level up/down from `d`, clamped to the configured levels. */
export function stepUp(d: Difficulty): Difficulty {
  return DIFFICULTY_ORDER[Math.min(rank(d) + 1, DIFFICULTY_ORDER.length - 1)] ?? d;
}
export function stepDown(d: Difficulty): Difficulty {
  return DIFFICULTY_ORDER[Math.max(rank(d) - 1, 0)] ?? d;
}

export interface PastRound {
  difficulty: Difficulty;
  policyBand: PerformanceBand;
}

/**
 * Number of consecutive rounds, ending with the current one, that were at `difficulty` and in
 * `band`. `earlier` is ordered oldest first and must not include the current round. Always >= 1.
 */
export function consecutiveInBand(
  difficulty: Difficulty,
  band: PerformanceBand,
  earlier: readonly PastRound[],
): number {
  let count = 1;
  for (let i = earlier.length - 1; i >= 0; i--) {
    const r = earlier[i]!;
    if (r.difficulty !== difficulty || r.policyBand !== band) break;
    count++;
  }
  return count;
}

export interface AllowedMoves {
  allowed: Difficulty[];
  /** True when the player has repeated this band long enough that staying is not allowed. */
  forced: boolean;
}

/** The only next levels the backend will accept for this round. Never empty, never skips a level. */
export function allowedNextDifficulties(
  difficulty: Difficulty,
  band: PerformanceBand,
  earlier: readonly PastRound[],
): AllowedMoves {
  const up = stepUp(difficulty);
  const down = stepDown(difficulty);
  const unique = (xs: Difficulty[]) => [...new Set(xs)];
  const repeats = consecutiveInBand(difficulty, band, earlier);
  const forced = band !== 'mixed' && repeats >= PERFORMANCE_POLICY.forcedMoveAfterRounds;

  if (band === 'strong') return { allowed: forced ? [up] : unique([difficulty, up]), forced };
  if (band === 'weak') return { allowed: forced ? [down] : unique([down, difficulty]), forced };
  return { allowed: [difficulty], forced: false };
}

/**
 * Whether the model's own rating is coherent with its move: going up needs a good/strong
 * rating, going down needs a weak rating, staying is compatible with any rating.
 */
export function ratingFitsMove(current: Difficulty, next: Difficulty, rating: PerformanceRating): boolean {
  if (rank(next) > rank(current)) return rating === 'strong' || rating === 'good';
  if (rank(next) < rank(current)) return rating === 'weak';
  return true;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Deterministic fallback used only when the player chooses it after Gemini could not decide.
 * strong -> one level up, weak -> one level down, mixed -> stay. The wording says it is a rule,
 * not AI, and no result produced here may be labelled as a Gemini decision.
 */
export function fallbackDecision(stats: RoundStats): { nextDifficulty: Difficulty; reason: string } {
  const band = classifyRound(stats);
  const level = DIFFICULTY_CONFIG[stats.difficulty];
  const { targets } = level;
  const played = `${plural(stats.moves, 'move')} and ${plural(stats.elapsedSeconds, 'active second')} against ${level.label} targets of ${targets.maxMoves} moves and ${targets.maxSeconds} seconds`;

  if (band === 'strong') {
    const nextDifficulty = stepUp(stats.difficulty);
    return {
      nextDifficulty,
      reason:
        nextDifficulty === stats.difficulty
          ? `You needed ${played}, comfortably inside both, and ${level.label} is the top level, so you stay.`
          : `You needed ${played}, comfortably inside both, so the rules move you up to ${DIFFICULTY_CONFIG[nextDifficulty].label}.`,
    };
  }
  if (band === 'weak') {
    const nextDifficulty = stepDown(stats.difficulty);
    return {
      nextDifficulty,
      reason:
        nextDifficulty === stats.difficulty
          ? `You needed ${played}, over at least one target, and ${level.label} is the lowest level, so you stay.`
          : `You needed ${played}, over at least one target, so the rules move you down to ${DIFFICULTY_CONFIG[nextDifficulty].label}.`,
    };
  }
  return {
    nextDifficulty: stats.difficulty,
    reason: `You needed ${played}: inside the targets but without a clear margin, so the rules keep you on ${level.label}.`,
  };
}
