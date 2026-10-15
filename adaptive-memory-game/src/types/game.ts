export type Difficulty = 'easy' | 'medium' | 'hard';
export type CardStatus = 'faceDown' | 'faceUp' | 'matched';
export type GameStatus = 'idle' | 'playing' | 'won';

export interface Card {
  /** Stable unique ID (does not change when the deck is shuffled). */
  id: string;
  /** Shared by the two cards that form a pair. */
  pairId: string;
  symbol: string;
  label: string;
  status: CardStatus;
}

export interface GameState {
  cards: Card[];
  moves: number;
  matchedPairs: number;
  status: GameStatus;
  /** True while two unmatched cards are shown and waiting to flip back. */
  resolving: boolean;
  difficulty: Difficulty;
  /** Increments for every new board. Used to ignore callbacks from older rounds. */
  roundId: number;
}

export type GameAction =
  | { type: 'FLIP_CARD'; cardId: string }
  | { type: 'RESOLVE_MISMATCH'; roundId: number }
  | { type: 'NEW_ROUND'; difficulty: Difficulty; seedBase?: number };

export interface RoundTargets {
  maxMoves: number;
  maxSeconds: number;
}

export interface DifficultySettings {
  label: string;
  /** Number of grid columns. */
  columns: number;
  /** Number of grid rows. columns * rows must equal pairCount * 2. */
  rows: number;
  /** Number of unique card pairs on the board. */
  pairCount: number;
  /** How long an unmatched pair stays visible before flipping back. */
  mismatchDelayMs: number;
  /** A round meets its targets when moves <= maxMoves AND seconds <= maxSeconds. */
  targets: RoundTargets;
}

export interface AdaptivePolicy {
  initialDifficulty: Difficulty;
  /** Next difficulty when the completed round met both targets. */
  onTargetsMet: Record<Difficulty, Difficulty>;
  /** Next difficulty when the completed round missed a target. */
  onTargetsMissed: Record<Difficulty, Difficulty>;
}

export interface RoundSummary {
  difficulty: Difficulty;
  moves: number;
  elapsedSeconds: number;
}

export interface DifficultyDecision {
  nextDifficulty: Difficulty;
  movesWithinTarget: boolean;
  timeWithinTarget: boolean;
  targetsMet: boolean;
  message: string;
}

export interface SessionRecord {
  sessionId: string;
  /** ISO 8601 timestamp. */
  completedAt: string;
  moves: number;
  elapsedSeconds: number;
  difficulty: Difficulty;
  nextDifficulty: Difficulty;
}
