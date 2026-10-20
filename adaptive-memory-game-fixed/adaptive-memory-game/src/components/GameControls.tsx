interface GameControlsProps {
  onRestart: () => void;
  onNewGame: () => void;
  onNextRound?: () => void;
  nextRoundLabel?: string;
}

export function GameControls({ onRestart, onNewGame, onNextRound, nextRoundLabel }: GameControlsProps) {
  return (
    <div className="controls">
      {onNextRound && (
        <button type="button" className="btn btn-primary" onClick={onNextRound}>
          Next round{nextRoundLabel ? ` (${nextRoundLabel})` : ''}
        </button>
      )}
      <button type="button" className="btn" onClick={onRestart}>
        Restart round
      </button>
      <button type="button" className="btn" onClick={onNewGame}>
        New game
      </button>
    </div>
  );
}
