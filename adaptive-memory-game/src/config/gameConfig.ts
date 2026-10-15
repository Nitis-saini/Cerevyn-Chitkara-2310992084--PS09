import type { AdaptivePolicy, Difficulty, DifficultySettings } from '../types/game';

/**
 * Pool of unique symbols. A round with N pairs uses the first N entries,
 * so this must contain at least as many symbols as the largest pairCount.
 */
export const CARD_SYMBOLS = [
  { id: 'rocket', symbol: '🚀', label: 'Rocket' },
  { id: 'cactus', symbol: '🌵', label: 'Cactus' },
  { id: 'headphones', symbol: '🎧', label: 'Headphones' },
  { id: 'watermelon', symbol: '🍉', label: 'Watermelon' },
  { id: 'telescope', symbol: '🔭', label: 'Telescope' },
  { id: 'puzzle', symbol: '🧩', label: 'Puzzle piece' },
  { id: 'octopus', symbol: '🐙', label: 'Octopus' },
  { id: 'dice', symbol: '🎲', label: 'Dice' },
  { id: 'fox', symbol: '🦊', label: 'Fox' },
  { id: 'guitar', symbol: '🎸', label: 'Guitar' },
  { id: 'pizza', symbol: '🍕', label: 'Pizza' },
  { id: 'rainbow', symbol: '🌈', label: 'Rainbow' },
  { id: 'anchor', symbol: '⚓', label: 'Anchor' },
  { id: 'key', symbol: '🔑', label: 'Key' },
  { id: 'mushroom', symbol: '🍄', label: 'Mushroom' },
  { id: 'turtle', symbol: '🐢', label: 'Turtle' },
  { id: 'target', symbol: '🎯', label: 'Target' },
  { id: 'bicycle', symbol: '🚲', label: 'Bicycle' },
] as const;

/**
 * Everything that defines a difficulty level lives here: grid size, pair count,
 * mismatch display time and the performance targets used by the adaptive rule.
 * Keep columns * rows === pairCount * 2 (checked by a unit test).
 *
 * Targets give players progressively more moves and time as the board grows.
 * A round meets its targets when moves <= maxMoves AND seconds <= maxSeconds
 * (boundaries are inclusive; elapsed time is truncated to whole seconds).
 */
export const DIFFICULTY_CONFIG: Record<Difficulty, DifficultySettings> = {
  easy: {
    label: 'Easy',
    columns: 4,
    rows: 4,
    pairCount: 8,
    mismatchDelayMs: 1000,
    targets: { maxMoves: 24, maxSeconds: 90 },
  },
  medium: {
    label: 'Medium',
    columns: 5,
    rows: 4,
    pairCount: 10,
    mismatchDelayMs: 900,
    targets: { maxMoves: 35, maxSeconds: 150 },
  },
  hard: {
    label: 'Hard',
    columns: 6,
    rows: 6,
    pairCount: 18,
    mismatchDelayMs: 800,
    targets: { maxMoves: 60, maxSeconds: 300 },
  },
};

/** Display and iteration order, easiest first. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** Which difficulty comes next, given the current one and the outcome. */
export const ADAPTIVE_POLICY: AdaptivePolicy = {
  initialDifficulty: 'easy',
  onTargetsMet: { easy: 'medium', medium: 'hard', hard: 'hard' },
  onTargetsMissed: { easy: 'easy', medium: 'easy', hard: 'easy' },
};

export const HISTORY_CONFIG = {
  storageKey: 'adaptive-memory-game:history:v1',
  maxStoredResults: 50,
  visibleResults: 5,
} as const;
