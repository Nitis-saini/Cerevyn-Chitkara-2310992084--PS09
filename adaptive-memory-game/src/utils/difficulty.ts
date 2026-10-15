import { ADAPTIVE_POLICY, DIFFICULTY_CONFIG } from '../config/gameConfig';
import type {
  AdaptivePolicy,
  Difficulty,
  DifficultyDecision,
  DifficultySettings,
  RoundSummary,
} from '../types/game';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Decide the difficulty of the NEXT round from a completed round.
 * Targets are inclusive: moves === maxMoves and seconds === maxSeconds still pass.
 */
export function evaluateRound(
  round: RoundSummary,
  config: Record<Difficulty, DifficultySettings> = DIFFICULTY_CONFIG,
  policy: AdaptivePolicy = ADAPTIVE_POLICY,
): DifficultyDecision {
  const { targets } = config[round.difficulty];
  const movesWithinTarget = round.moves <= targets.maxMoves;
  const timeWithinTarget = round.elapsedSeconds <= targets.maxSeconds;
  const targetsMet = movesWithinTarget && timeWithinTarget;

  const nextDifficulty = targetsMet
    ? policy.onTargetsMet[round.difficulty]
    : policy.onTargetsMissed[round.difficulty];

  const next = config[nextDifficulty];
  const nextBoard = `${next.label} (${next.columns}×${next.rows} grid, ${next.pairCount} pairs)`;
  const currentLabel = config[round.difficulty].label;
  const summary = `You completed the previous round in ${plural(round.moves, 'move')} and ${plural(round.elapsedSeconds, 'second')}.`;

  let reason: string;
  if (targetsMet) {
    reason = `because you met both ${currentLabel} targets (${targets.maxMoves} moves or fewer and ${targets.maxSeconds} seconds or less)`;
  } else if (!movesWithinTarget && !timeWithinTarget) {
    reason = `because you exceeded both the move limit (${targets.maxMoves}) and the time limit (${targets.maxSeconds} seconds)`;
  } else if (!movesWithinTarget) {
    reason = `because you exceeded the move limit (${targets.maxMoves})`;
  } else {
    reason = `because you exceeded the time limit (${targets.maxSeconds} seconds)`;
  }

  return {
    nextDifficulty,
    movesWithinTarget,
    timeWithinTarget,
    targetsMet,
    message: `${summary} Your next round will be ${nextBoard} ${reason}.`,
  };
}
