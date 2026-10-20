import { DIFFICULTY_CONFIG, DIFFICULTY_ORDER } from '../config/gameConfig';
import type {
  DecisionSource,
  Difficulty,
  DifficultyDecision,
  EvaluationFailureReason,
  PerformanceRating,
} from '../types/game';

/** Progress of the server-side (Gemini) evaluation of the finished round. */
export type EvaluationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'decided';
      source: DecisionSource;
      nextDifficulty: Difficulty;
      reason: string;
      performance: PerformanceRating | null;
    }
  | { status: 'failed'; reason: EvaluationFailureReason; message: string };

interface GameResultProps {
  decision: DifficultyDecision;
  totalPairs: number;
  /** Present only when the game runs with the Gemini evaluation service. */
  evaluation?: EvaluationState;
  /** The level that was just played (used to show whether the player moves up, down or stays). */
  playedDifficulty?: Difficulty;
  onRetry?: () => void;
  onUseFallback?: () => void;
}

const boardOf = (d: Difficulty) => {
  const c = DIFFICULTY_CONFIG[d];
  return `${c.label} (${c.columns}×${c.rows} grid, ${c.pairCount} pairs)`;
};

const SOURCE_LABEL: Record<DecisionSource, string> = {
  gemini: 'Decided by Gemini',
  rules_fallback: 'Rule-based fallback, not decided by AI',
  local_rules: 'Rule-based fallback computed in your browser, not decided by AI',
};

export function GameResult({
  decision,
  totalPairs,
  evaluation,
  playedDifficulty,
  onRetry,
  onUseFallback,
}: GameResultProps) {
  // Rules mode (no evaluation service): unchanged behaviour.
  if (!evaluation) {
    return (
      <section
        className="result"
        role="status"
        aria-live="polite"
        data-testid="result"
        data-outcome={decision.targetsMet ? 'advance' : 'retry'}
      >
        <h2>
          <span className="result-icon" aria-hidden="true">
            ✓
          </span>
          You matched all {totalPairs} pairs!
        </h2>
        <div className="result-next">
          <span className="result-next-icon" aria-hidden="true">
            {decision.targetsMet ? '▲' : '↺'}
          </span>
          <p data-testid="result-message">{decision.message}</p>
        </div>
      </section>
    );
  }

  const decided = evaluation.status === 'decided' ? evaluation : null;
  const movesUp =
    decided !== null &&
    playedDifficulty !== undefined &&
    DIFFICULTY_ORDER.indexOf(decided.nextDifficulty) > DIFFICULTY_ORDER.indexOf(playedDifficulty);

  return (
    <section
      className="result"
      role="status"
      aria-live="polite"
      data-testid="result"
      data-outcome={movesUp ? 'advance' : 'retry'}
      data-evaluation={evaluation.status}
    >
      <h2>
        <span className="result-icon" aria-hidden="true">
          ✓
        </span>
        You matched all {totalPairs} pairs!
      </h2>
      <div className="result-next">
        <span className="result-next-icon" aria-hidden="true">
          {evaluation.status === 'loading' ? '…' : movesUp ? '▲' : '↺'}
        </span>
        <div>
          {evaluation.status === 'loading' && (
            <p data-testid="result-message">
              Gemini is evaluating your round and choosing the next difficulty…
            </p>
          )}

          {decided && (
            <>
              <p data-testid="result-message">
                Your next round will be {boardOf(decided.nextDifficulty)}.
              </p>
              <p data-testid="decision-reason">{decided.reason}</p>
              <p className="muted" data-testid="decision-source" data-source={decided.source}>
                {SOURCE_LABEL[decided.source]}
                {decided.performance ? ` · performance: ${decided.performance}` : ''}
              </p>
            </>
          )}

          {evaluation.status === 'failed' && (
            <>
              <p data-testid="result-message">
                Adaptive evaluation failed: {evaluation.message} No next difficulty has been chosen
                yet.
              </p>
              <div className="result-actions">
                <button type="button" className="btn btn-primary" onClick={onRetry}>
                  Retry evaluation
                </button>
                <button type="button" className="btn" onClick={onUseFallback}>
                  Use rule-based difficulty (not AI)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
