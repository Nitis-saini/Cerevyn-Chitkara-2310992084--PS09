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


export const PERFORMANCE_POLICY = {
  strongBudgetRatio: 0.75,
  strongMaxMismatchRate: 0.5,
  forcedMoveAfterRounds: 2,
  
  historyWindow: 5,
} as const;
