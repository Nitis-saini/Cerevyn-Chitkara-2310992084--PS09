import type { DifficultyDecision } from '../types/game';

interface GameResultProps {
  decision: DifficultyDecision;
  totalPairs: number;
}

export function GameResult({ decision, totalPairs }: GameResultProps) {
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
