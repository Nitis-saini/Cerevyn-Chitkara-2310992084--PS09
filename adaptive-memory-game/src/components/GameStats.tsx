import { DIFFICULTY_CONFIG } from '../config/gameConfig';
import type { Difficulty } from '../types/game';
import { formatTime } from '../utils/gameLogic';

interface GameStatsProps {
  moves: number;
  matchedPairs: number;
  totalPairs: number;
  elapsedMs: number;
  difficulty: Difficulty;
  bestSeconds: number | null;
  bestMoves: number | null;
}

export function GameStats({
  moves,
  matchedPairs,
  totalPairs,
  elapsedMs,
  difficulty,
  bestSeconds,
  bestMoves,
}: GameStatsProps) {
  const { targets, label, columns, rows } = DIFFICULTY_CONFIG[difficulty];
  return (
    <section className="stats" aria-label="Game statistics">
      <div className="stats-head">
        <span className={`badge badge-${difficulty}`} data-testid="difficulty-badge">
          Difficulty: {label}
        </span>
        <span className="stats-target" data-testid="board-info">
          {columns}×{rows} grid, {totalPairs} pairs
        </span>
      </div>
      <div className="stats-target-row" data-testid="targets">
        Targets: {targets.maxMoves} moves or fewer and {targets.maxSeconds} seconds or less
      </div>
      <dl className="stats-grid">
        <div>
          <dt>Moves</dt>
          <dd data-testid="moves">{moves}</dd>
        </div>
        <div>
          <dt>Pairs</dt>
          <dd data-testid="pairs">
            {matchedPairs} / {totalPairs}
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd data-testid="time">{formatTime(elapsedMs)}</dd>
        </div>
        <div>
          <dt>Best time</dt>
          <dd data-testid="best-time">{bestSeconds === null ? 'None yet' : formatTime(bestSeconds * 1000)}</dd>
        </div>
        <div>
          <dt>Fewest moves</dt>
          <dd data-testid="best-moves">{bestMoves === null ? 'None yet' : bestMoves}</dd>
        </div>
      </dl>
    </section>
  );
}
