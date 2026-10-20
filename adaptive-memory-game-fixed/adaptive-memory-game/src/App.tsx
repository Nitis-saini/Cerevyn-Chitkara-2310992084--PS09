import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { GameBoard } from './components/GameBoard';
import { GameControls } from './components/GameControls';
import { GameResult, type EvaluationState } from './components/GameResult';
import { GameStats } from './components/GameStats';
import { SessionHistory } from './components/SessionHistory';
import { ADAPTIVE_POLICY, DIFFICULTY_CONFIG } from './config/gameConfig';
import { useGameTimer } from './hooks/useGameTimer';
import type { RoundEvaluator } from './services/roundApi';
import type {
  Difficulty,
  EvaluationResult,
  RoundSubmission,
  SessionRecord,
  StoredRound,
} from './types/game';
import { statsForRound } from './utils/roundStats';
import { evaluateRound } from './utils/difficulty';
import { createInitialState, gameReducer } from './utils/gameLogic';
import { fallbackDecision } from './utils/performancePolicy';
import { recordFromRound, recordsFromRounds } from './utils/roundRecords';
import {
  addRecord,
  clearHistory,
  clearServerSessionId,
  createSessionId,
  getBestResults,
  loadHistory,
  loadServerSessionId,
  replaceHistory,
  saveServerSessionId,
  upsertRecord,
} from './utils/sessionStorage';

interface AppProps {
 
  initialSeed?: number;

  roundEvaluator?: RoundEvaluator;
}


interface PendingRound {
  roundId: number;
  submission: RoundSubmission;
  previousRecord: SessionRecord | undefined;
}

export default function App({ initialSeed, roundEvaluator }: AppProps) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    createInitialState(ADAPTIVE_POLICY.initialDifficulty, 0, initialSeed),
  );
  const [decision, setDecision] = useState<ReturnType<typeof evaluateRound> | null>(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [sessionId] = useState(createSessionId);
  const [historyNotice, setHistoryNotice] = useState('');
  const [evaluation, setEvaluation] = useState<EvaluationState>({ status: 'idle' });
  const recordedRoundRef = useRef<number | null>(null);
  const currentRoundRef = useRef(state.roundId);
  const evalAbortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<PendingRound | null>(null);
  // The anonymous session ID is issued by the server and kept so history survives reloads.
  const [initialServerSession] = useState(() => (roundEvaluator ? loadServerSessionId() : null));
  const serverSessionRef = useRef<string | null>(initialServerSession);
  const geminiMode = roundEvaluator !== undefined;

  // Active play time only: the clock also pauses while the tab is hidden.
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onChange = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const { elapsedMs, getElapsedMs } = useGameTimer(
    state.status === 'playing' && pageVisible,
    state.roundId,
  );

  // Never let an in-flight evaluation request outlive the component.
  useEffect(
    () => () => {
      evalAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const sessionId = serverSessionRef.current;
    if (!roundEvaluator || !sessionId) return;
    const controller = new AbortController();
    void roundEvaluator.fetchHistory(sessionId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status === 'ok') {
        setHistory(replaceHistory(recordsFromRounds(result.rounds)));
      } else if (result.reason === 'session_not_found') {
        serverSessionRef.current = null; // the server no longer knows this session
        clearServerSessionId();
      }
    });
    return () => controller.abort();
  }, [roundEvaluator]);


  const runEvaluation = useCallback(
    async (mode: 'evaluate' | 'fallback') => {
      const pending = pendingRef.current;
      if (!roundEvaluator || !pending) return;
      evalAbortRef.current?.abort();
      const controller = new AbortController();
      evalAbortRef.current = controller;
      const { signal } = controller;
      const { roundId, submission, previousRecord } = pending;
      const stale = () => signal.aborted || currentRoundRef.current !== roundId;
      setEvaluation({ status: 'loading' });

      const newSession = async (): Promise<string | EvaluationResult> => {
        const created = await roundEvaluator.createSession(signal);
        if (created.status !== 'ok') return created;
        serverSessionRef.current = created.sessionId;
        saveServerSessionId(created.sessionId);
        return created.sessionId;
      };

      const attempt = async (): Promise<EvaluationResult> => {
        let sessionId = serverSessionRef.current;
        if (!sessionId) {
          const created = await newSession();
          if (typeof created !== 'string') return created;
          sessionId = created;
        }
        const call = (id: string) =>
          mode === 'fallback'
            ? roundEvaluator.useFallback(id, submission.clientRoundId, signal)
            : roundEvaluator.submitRound(id, submission, signal);
        const result = await call(sessionId);
        if (mode === 'evaluate' && result.status === 'unavailable' && result.reason === 'session_not_found') {
          // The server forgot this anonymous session: start a new one and submit once more.
          const created = await newSession();
          return typeof created === 'string' ? call(created) : created;
        }
        return result;
      };

      const result = await attempt();
      if (stale()) return;

      if (result.status === 'ok') {
        const round: StoredRound = result.round;
        const decided = round.decision!;
        setHistory(
          upsertRecord({ ...recordFromRound(round), previousDifficulty: previousRecord?.difficulty ?? null }),
        );
        setEvaluation({
          status: 'decided',
          source: decided.source,
          nextDifficulty: decided.nextDifficulty,
          reason: decided.reason,
          performance: decided.performance,
        });
        return;
      }

      if (mode === 'fallback') {
       
        const local = fallbackDecision(submission);
        const recordId = `${sessionId}-r${roundId}`;
        setHistory(
          upsertRecord({
            sessionId,
            roundId: recordId,
            completedAt: new Date().toISOString(),
            moves: submission.moves,
            elapsedSeconds: submission.elapsedSeconds,
            difficulty: submission.difficulty,
            previousDifficulty: previousRecord?.difficulty ?? null,
            nextDifficulty: local.nextDifficulty,
            gridColumns: submission.gridColumns,
            gridRows: submission.gridRows,
            completedPairs: submission.completedPairs,
            mismatches: submission.mismatches,
            reason: local.reason,
            aiCoachSucceeded: false,
            decisionSource: 'local_rules',
          }),
        );
        setEvaluation({
          status: 'decided',
          source: 'local_rules',
          nextDifficulty: local.nextDifficulty,
          reason: local.reason,
          performance: null,
        });
        return;
      }

      setEvaluation({ status: 'failed', reason: result.reason, message: result.message });
    },
    [roundEvaluator, sessionId],
  );


  const { resolving, roundId, difficulty } = state;
  useEffect(() => {
    if (!resolving) return;
    const id = setTimeout(
      () => dispatch({ type: 'RESOLVE_MISMATCH', roundId }),
      DIFFICULTY_CONFIG[difficulty].mismatchDelayMs,
    );
    return () => clearTimeout(id);
  }, [resolving, roundId, difficulty]);

  
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

    const { columns, rows } = DIFFICULTY_CONFIG[state.difficulty];
    const completedPairs = state.matchedPairs;
    const recordId = `${sessionId}-r${state.roundId}`;
    const previous = history[history.length - 1];

    if (roundEvaluator) {
     
      pendingRef.current = {
        roundId: state.roundId,
        previousRecord: previous,
        submission: {
          ...statsForRound(state.difficulty, state.moves, completedPairs, elapsedSeconds),
          clientRoundId: createSessionId(),
          completed: true,
        },
      };
      void runEvaluation('evaluate');
      return;
    }
    setHistory(
      addRecord({
        sessionId,
        roundId: recordId,
        completedAt: new Date().toISOString(),
        moves: state.moves,
        elapsedSeconds,
        difficulty: state.difficulty,
        previousDifficulty: previous?.difficulty ?? null,
        nextDifficulty: result.nextDifficulty,
        gridColumns: columns,
        gridRows: rows,
        completedPairs,
        mismatches: state.mismatches,
        reason: result.message,
        aiCoachSucceeded: false,
      }),
    );
  }, [
    state.status,
    state.roundId,
    state.difficulty,
    state.moves,
    state.mismatches,
    state.matchedPairs,
    getElapsedMs,
    sessionId,
    history,
    roundEvaluator,
    runEvaluation,
  ]);

  const handleCardSelect = useCallback((cardId: string) => {
    dispatch({ type: 'FLIP_CARD', cardId });
  }, []);

  const startRound = (nextDifficulty: Difficulty) => {
    evalAbortRef.current?.abort();
    pendingRef.current = null;
    currentRoundRef.current = state.roundId + 1;
    setEvaluation({ status: 'idle' });
    setDecision(null);
    dispatch({ type: 'NEW_ROUND', difficulty: nextDifficulty, seedBase: initialSeed });
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
    setHistoryNotice('History cleared.');
    const serverSession = serverSessionRef.current;
    if (roundEvaluator && serverSession) {
    
      void roundEvaluator.deleteSession(serverSession);
      serverSessionRef.current = null;
      clearServerSessionId();
    }
  };

  const totalPairs = state.cards.length / 2;
  //const { targets, label } = DIFFICULTY_CONFIG[state.difficulty];
 // const ifMet = DIFFICULTY_CONFIG[ADAPTIVE_POLICY.onTargetsMet[state.difficulty]].label;
 // const ifMissed = DIFFICULTY_CONFIG[ADAPTIVE_POLICY.onTargetsMissed[state.difficulty]].label;
  const { bestSeconds, bestMoves } = getBestResults(history);
  const won = state.status === 'won' && decision !== null;
  
  const nextDifficulty: Difficulty | null = !won
    ? null
    : geminiMode
      ? evaluation.status === 'decided'
        ? evaluation.nextDifficulty
        : null
      : decision.nextDifficulty;

  return (
    <main className="app">
      <header className="header">
        <h1>Adaptive Memory Match</h1>
        <p>
          Flip two cards at a time and find all {totalPairs} pairs. Finish fast and with few moves,
          and the next round gets bigger and harder.
        </p>
        
      </header>

      <div className="layout">
        <div className="play-area">
          <GameStats
            moves={state.moves}
            mismatches={state.mismatches}
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
            <>
              <GameResult
                decision={decision}
                totalPairs={totalPairs}
                evaluation={geminiMode ? evaluation : undefined}
                playedDifficulty={state.difficulty}
                onRetry={() => void runEvaluation('evaluate')}
                onUseFallback={() => void runEvaluation('fallback')}
              />
            </>
          ) : (
            <p className="hint">
              The timer starts when you flip your first card. Your result decides the next round's
              difficulty.
            </p>
          )}
          <GameControls
            onRestart={() => startRound(state.difficulty)}
            onNewGame={() => startRound(ADAPTIVE_POLICY.initialDifficulty)}
            onNextRound={nextDifficulty ? () => startRound(nextDifficulty) : undefined}
            nextRoundLabel={nextDifficulty ? DIFFICULTY_CONFIG[nextDifficulty].label : undefined}
          />
          <SessionHistory
            records={history}
            onClear={handleClearHistory}
            notice={historyNotice}
            confirmMessage={
              geminiMode
                ? 'Delete all saved results for this anonymous session, including the copy stored on the server? This cannot be undone.'
                : undefined
            }
          />
        </aside>
      </div>
    </main>
  );
}
