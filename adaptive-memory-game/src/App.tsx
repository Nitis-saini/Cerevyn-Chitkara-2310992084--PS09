import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { GameBoard } from './components/GameBoard';
import { GameControls } from './components/GameControls';
import { GameResult } from './components/GameResult';
import { GameStats } from './components/GameStats';
import { SessionHistory } from './components/SessionHistory';
import { ADAPTIVE_POLICY, DIFFICULTY_CONFIG } from './config/gameConfig';
import { useGameTimer } from './hooks/useGameTimer';
import type { Difficulty, DifficultyDecision } from './types/game';
import { evaluateRound } from './utils/difficulty';
import { createInitialState, gameReducer } from './utils/gameLogic';
import {
  addRecord,
  clearHistory,
  createSessionId,
  getBestResults,
  loadHistory,
} from './utils/sessionStorage';

interface AppProps {
  /** Optional seed for a reproducible first board (used by automated tests). */
  initialSeed?: number;
}

export default function App({ initialSeed }: AppProps) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    createInitialState(ADAPTIVE_POLICY.initialDifficulty, 0, initialSeed),
  );
  const [decision, setDecision] = useState<DifficultyDecision | null>(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [sessionId] = useState(createSessionId);
  const recordedRoundRef = useRef<number | null>(null);

  const { elapsedMs, getElapsedMs } = useGameTimer(state.status === 'playing', state.roundId);

  // Flip an unmatched pair back after the delay. The effect cleanup cancels the
  // timeout on restart/unmount, and the reducer also ignores callbacks from old rounds.
  const { resolving, roundId, difficulty } = state;
  useEffect(() => {
    if (!resolving) return;
    const id = setTimeout(
      () => dispatch({ type: 'RESOLVE_MISMATCH', roundId }),
      DIFFICULTY_CONFIG[difficulty].mismatchDelayMs,
    );
    return () => clearTimeout(id);
  }, [resolving, roundId, difficulty]);

  // Evaluate the finished round exactly once, then save it.
  useEffect(() => {
    if (state.status !== 'won' || recordedRoundRef.current === state.roundId) return;
    recordedRoundRef.current = state.roundId;

    const elapsedSeconds = Math.floor(getElapsedMs() / 1000);
    const result = evaluateRound({
      difficulty: state.difficulty,
      moves: state.moves,
      elapsedSeconds,
    });
    setDecision(result);
    setHistory(
      addRecord({
        sessionId,
        completedAt: new Date().toISOString(),
        moves: state.moves,
        elapsedSeconds,
        difficulty: state.difficulty,
        nextDifficulty: result.nextDifficulty,
      }),
    );
  }, [state.status, state.roundId, state.difficulty, state.moves, getElapsedMs, sessionId]);

  const handleCardSelect = useCallback((cardId: string) => {
    dispatch({ type: 'FLIP_CARD', cardId });
  }, []);

  const startRound = (nextDifficulty: Difficulty) => {
    setDecision(null);
    dispatch({ type: 'NEW_ROUND', difficulty: nextDifficulty, seedBase: initialSeed });
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  const totalPairs = state.cards.length / 2;
  const { targets, label } = DIFFICULTY_CONFIG[state.difficulty];
  const ifMet = DIFFICULTY_CONFIG[ADAPTIVE_POLICY.onTargetsMet[state.difficulty]].label;
  const ifMissed = DIFFICULTY_CONFIG[ADAPTIVE_POLICY.onTargetsMissed[state.difficulty]].label;
  const { bestSeconds, bestMoves } = getBestResults(history);
  const won = state.status === 'won' && decision !== null;

  return (
    <main className="app">
      <header className="header">
        <h1>Adaptive Memory Match</h1>
        <p>
          Flip two cards at a time and find all {totalPairs} pairs. Finish fast and with few moves,
          and the next round gets bigger and harder.
        </p>
        <p className="header-targets" data-testid="instructions-targets">
          {label} targets: {targets.maxMoves} moves or fewer and {targets.maxSeconds} seconds or less.
          Meet both to play {ifMet} next; miss either and the next round is {ifMissed}.
        </p>
      </header>

      <div className="layout">
        <div className="play-area">
          <GameStats
            moves={state.moves}
            matchedPairs={state.matchedPairs}
            totalPairs={totalPairs}
            elapsedMs={elapsedMs}
            difficulty={state.difficulty}
            bestSeconds={bestSeconds}
            bestMoves={bestMoves}
          />
          <GameBoard cards={state.cards} difficulty={state.difficulty} onCardSelect={handleCardSelect} />
        </div>

        <aside className="side">
          {won ? (
            <GameResult decision={decision} totalPairs={totalPairs} />
          ) : (
            <p className="hint">
              The timer starts when you flip your first card. Your result decides the next round's
              difficulty.
            </p>
          )}
          <GameControls
            onRestart={() => startRound(state.difficulty)}
            onNewGame={() => startRound(ADAPTIVE_POLICY.initialDifficulty)}
            onNextRound={won ? () => startRound(decision.nextDifficulty) : undefined}
            nextRoundLabel={won ? DIFFICULTY_CONFIG[decision.nextDifficulty].label : undefined}
          />
          <SessionHistory records={history} onClear={handleClearHistory} />
        </aside>
      </div>
    </main>
  );
}
