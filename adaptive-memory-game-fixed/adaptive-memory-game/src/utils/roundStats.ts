import { DIFFICULTY_CONFIG } from '../config/gameConfig';
import type { RoundStats, Difficulty } from '../types/game';

export function statsForRound(
  difficulty: Difficulty,
  moves: number,
  completedPairs: number,
  elapsedSeconds: number,
): RoundStats {
  const { columns, rows, pairCount } = DIFFICULTY_CONFIG[difficulty];
  return {
    difficulty,
    gridColumns: columns,
    gridRows: rows,
    pairCount,
    completedPairs,
    moves,
    mismatches: moves - completedPairs,
    elapsedSeconds,
  };
}
