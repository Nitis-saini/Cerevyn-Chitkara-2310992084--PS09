import type { SessionRecord, StoredRound } from '../types/game';

/**
 * Maps server rounds (oldest first) to the history records the UI shows. A round whose decision
 * never arrived keeps its played level as `nextDifficulty` and is marked 'pending' so the UI can
 * say no decision exists, instead of inventing one.
 */
export function recordsFromRounds(rounds: readonly StoredRound[]): SessionRecord[] {
  return rounds.map((r, i) => {
    const decided = r.decisionStatus === 'decided' && r.decision !== null;
    return {
      sessionId: r.sessionId,
      roundId: `${r.sessionId}-r${r.roundNumber}`,
      completedAt: r.createdAt,
      moves: r.moves,
      elapsedSeconds: r.elapsedSeconds,
      difficulty: r.difficulty,
      previousDifficulty: rounds[i - 1]?.difficulty ?? null,
      nextDifficulty: r.decision?.nextDifficulty ?? r.difficulty,
      gridColumns: r.gridColumns,
      gridRows: r.gridRows,
      completedPairs: r.completedPairs,
      mismatches: r.mismatches,
      reason: decided ? r.decision!.reason : 'No difficulty decision was received for this round.',
      aiCoachSucceeded: r.decision?.source === 'gemini',
      decisionSource: decided ? r.decision!.source : 'pending',
      ...(r.decision?.performance ? { performance: r.decision.performance } : {}),
    };
  });
}

/** Single-round variant: needs the round before it (if any) for `previousDifficulty`. */
export function recordFromRound(round: StoredRound, previous?: StoredRound): SessionRecord {
  const list = previous ? [previous, round] : [round];
  return recordsFromRounds(list)[list.length - 1]!;
}
