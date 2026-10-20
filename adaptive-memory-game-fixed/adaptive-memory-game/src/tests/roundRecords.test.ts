import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredRound } from '../types/game';
import { recordFromRound, recordsFromRounds } from '../utils/roundRecords';
import {
  clearServerSessionId, loadHistory, loadServerSessionId, replaceHistory, saveServerSessionId, upsertRecord,
} from '../utils/sessionStorage';

const round = (n: number, over: Partial<StoredRound> = {}): StoredRound => ({
  sessionId: 'session-aaaa1111', roundNumber: n, clientRoundId: `round-000${n}`, difficulty: 'easy', gridColumns: 4,
  gridRows: 4, pairCount: 8, completedPairs: 8, moves: 12, mismatches: 4, elapsedSeconds: 40, completed: true,
  policyBand: 'strong', decisionStatus: 'decided',
  decision: { nextDifficulty: 'medium', source: 'gemini', performance: 'strong', reason: 'Quick and accurate.' },
  failureCode: null, model: 'm', createdAt: '2026-01-01T00:00:00.000Z', decidedAt: '2026-01-01T00:00:01.000Z', ...over,
});

describe('recordsFromRounds', () => {
  it('maps server rounds to history records, including previous difficulty and Gemini source', () => {
    const records = recordsFromRounds([round(1), round(2, { difficulty: 'medium', gridColumns: 5, gridRows: 4, pairCount: 10, completedPairs: 10 })]);
    expect(records[0]).toMatchObject({
      roundId: 'session-aaaa1111-r1', previousDifficulty: null, difficulty: 'easy', nextDifficulty: 'medium',
      mismatches: 4, reason: 'Quick and accurate.', aiCoachSucceeded: true, decisionSource: 'gemini', performance: 'strong',
    });
    expect(records[1]).toMatchObject({ previousDifficulty: 'easy', difficulty: 'medium' });
  });

  it('does not invent a decision for rounds that never got one', () => {
    const [r] = recordsFromRounds([round(1, { decisionStatus: 'failed', decision: null, failureCode: 'timeout' })]);
    expect(r).toMatchObject({ decisionSource: 'pending', aiCoachSucceeded: false, nextDifficulty: 'easy' });
    expect(r!.reason).toContain('No difficulty decision');
  });

  it('marks fallback decisions as not Gemini', () => {
    const [r] = recordsFromRounds([round(1, { decision: { nextDifficulty: 'medium', source: 'rules_fallback', performance: null, reason: 'Rules.' } })]);
    expect(r).toMatchObject({ decisionSource: 'rules_fallback', aiCoachSucceeded: false });
    expect(r).not.toHaveProperty('performance');
  });

  it('recordFromRound handles a single round', () => {
    expect(recordFromRound(round(3)).roundId).toBe('session-aaaa1111-r3');
  });
});

describe('server session ID and history mirror in localStorage', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves, loads and clears the anonymous session ID', () => {
    expect(loadServerSessionId()).toBeNull();
    saveServerSessionId('session-aaaa1111');
    expect(loadServerSessionId()).toBe('session-aaaa1111');
    clearServerSessionId();
    expect(loadServerSessionId()).toBeNull();
  });

  it('ignores a tampered session ID', () => {
    window.localStorage.setItem('adaptive-memory-game:server-session:v1', "x'; DROP TABLE rounds;--");
    expect(loadServerSessionId()).toBeNull();
    saveServerSessionId('bad id!'); // refuses to store it
    expect(loadServerSessionId()).toBeNull();
  });

  it('survives unavailable storage', () => {
    expect(loadServerSessionId(null)).toBeNull();
    expect(() => saveServerSessionId('session-aaaa1111', null)).not.toThrow();
    expect(() => clearServerSessionId(null)).not.toThrow();
  });

  it('replaceHistory mirrors the server list and upsertRecord replaces by roundId', () => {
    replaceHistory(recordsFromRounds([round(1), round(2)]));
    expect(loadHistory().map((r) => r.roundId)).toEqual(['session-aaaa1111-r1', 'session-aaaa1111-r2']);
    const updated = { ...recordsFromRounds([round(2)])[0]!, reason: 'Updated reason text.' };
    const next = upsertRecord(updated);
    expect(next).toHaveLength(2);
    expect(next[1]!.reason).toBe('Updated reason text.');
    expect(upsertRecord(recordsFromRounds([round(3)])[0]!)).toHaveLength(3);
  });
});
