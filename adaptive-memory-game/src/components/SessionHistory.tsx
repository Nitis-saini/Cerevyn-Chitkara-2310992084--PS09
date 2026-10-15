import { DIFFICULTY_CONFIG, HISTORY_CONFIG } from '../config/gameConfig';
import type { SessionRecord } from '../types/game';
import { formatTime } from '../utils/gameLogic';

interface SessionHistoryProps {
  records: SessionRecord[];
  onClear: () => void;
}

export function SessionHistory({ records, onClear }: SessionHistoryProps) {
  const recent = records.slice(-HISTORY_CONFIG.visibleResults).reverse();

  const handleClear = () => {
    if (window.confirm('Clear all saved results from this browser? This cannot be undone.')) {
      onClear();
    }
  };

  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title">Recent results</h2>
        <button type="button" className="btn btn-small" onClick={handleClear} disabled={records.length === 0}>
          Clear history
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="muted">No results yet. Finish a round and it will appear here.</p>
      ) : (
        <ol className="history-list" data-testid="history-list">
          {recent.map((r) => (
            <li key={`${r.sessionId}-${r.completedAt}`}>
              <span className="history-when">
                {new Date(r.completedAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span>
                {r.moves} moves, {formatTime(r.elapsedSeconds * 1000)}
              </span>
              <span className="muted">
                {DIFFICULTY_CONFIG[r.difficulty].label} to {DIFFICULTY_CONFIG[r.nextDifficulty].label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
