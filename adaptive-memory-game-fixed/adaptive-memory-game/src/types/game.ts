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
 
  mismatches: number;
  matchedPairs: number;
  status: GameStatus;
 
  resolving: boolean;
  difficulty: Difficulty;
 
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
 
  columns: number;
 
  rows: number;
 
  pairCount: number;
 
  mismatchDelayMs: number;
 
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
  /** Anonymous random ID created per page load. */
  sessionId: string;
  /** Unique per completed round: `${sessionId}-r${roundNumber}`. Optional for records saved by v1. */
  roundId?: string;
  /** ISO 8601 timestamp. */
  completedAt: string;
  moves: number;
  elapsedSeconds: number;
  /** Difficulty that was played. */
  difficulty: Difficulty;
  /** Difficulty of the round played before this one in the same session, if any. */
  previousDifficulty?: Difficulty | null;
  /** Difficulty chosen for the next round by the deterministic controller. */
  nextDifficulty: Difficulty;
  // The fields below are optional so history saved by earlier versions still loads.
  gridColumns?: number;
  gridRows?: number;
  completedPairs?: number;
  mismatches?: number;
  /** Human-readable explanation of the difficulty decision. */
  reason?: string;
  /** True only when a real LLM response was received and validated for this round. */
  aiCoachSucceeded?: boolean;
  /** Who chose `nextDifficulty`. 'pending' = round saved, decision not received yet. */
  decisionSource?: DecisionSource | 'pending';
  /** Gemini's own classification of the round (only when Gemini decided). */
  performance?: PerformanceRating;
}

/** Minimal statistics sent for round evaluation. No personal data. */
export interface RoundStats {
  difficulty: Difficulty;
  gridColumns: number;
  gridRows: number;
  pairCount: number;
  completedPairs: number;
  moves: number;
  mismatches: number;
  elapsedSeconds: number;
}



/** Classification computed in code from the level's targets (see PERFORMANCE_POLICY). */
export type PerformanceBand = 'strong' | 'mixed' | 'weak';
/** Gemini's own rating of the round. */
export type PerformanceRating = 'strong' | 'good' | 'mixed' | 'weak';
/**
 * Who chose the next difficulty. 'gemini' is only ever set after a validated model answer.
 * 'rules_fallback' = server-side deterministic fallback the player asked for; 'local_rules' =
 * the same rule computed in the browser because the server was unreachable. Neither is AI.
 */
export type DecisionSource = 'gemini' | 'rules_fallback' | 'local_rules';

/** A completed round as submitted to the server: numbers, enum values and an idempotency key. */
export interface RoundSubmission extends RoundStats {
  /** Random ID created once per finished round; retries reuse it so a round is stored once. */
  clientRoundId: string;
  completed: true;
}

export interface RoundDecision {
  nextDifficulty: Difficulty;
  source: DecisionSource;
  /** Gemini's rating; null for rule-based fallback decisions. */
  performance: PerformanceRating | null;
  reason: string;
}

export type RoundDecisionStatus = 'pending' | 'decided' | 'failed';

export interface StoredRound extends RoundStats {
  sessionId: string;
  /** 1-based, assigned by the server per session. */
  roundNumber: number;
  clientRoundId: string;
  completed: boolean;
  policyBand: PerformanceBand;
  decisionStatus: RoundDecisionStatus;
  decision: RoundDecision | null;
  /** Machine-readable reason the last decision attempt failed, if it did. */
  failureCode: string | null;
  model: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type EvaluationFailureReason =
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'invalid_response'
  | 'service_error'
  | 'invalid_request'
  | 'session_not_found'
  | 'round_not_found'
  | 'round_conflict'
  | 'persistence_error';

export type EvaluationResult =
  | { status: 'ok'; round: StoredRound }
  | { status: 'unavailable'; reason: EvaluationFailureReason; message: string };
