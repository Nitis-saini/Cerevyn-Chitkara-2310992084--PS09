// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_ROUNDS_PER_SESSION, StoreError, openStore, type NewRound, type RoundStore } from '../db';

const round = (id: string, over: Partial<NewRound> = {}): NewRound => ({
  clientRoundId: id, difficulty: 'easy', gridColumns: 4, gridRows: 4, pairCount: 8, completedPairs: 8,
  moves: 12, mismatches: 4, elapsedSeconds: 40, policyBand: 'strong', ...over,
});
const decision = { nextDifficulty: 'medium', source: 'gemini', performance: 'strong', reason: 'Strong round overall.', model: 'm' } as const;

const open: RoundStore[] = [];
const dirs: string[] = [];
const mem = () => { const s = openStore(':memory:'); open.push(s); return s; };
afterEach(() => {
  while (open.length) { try { open.pop()!.close(); } catch { /* already closed */ } }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('sessions and rounds', () => {
  it('stores a round with every required field, anonymously', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    const saved = store.insertRound('session-aaaa1111', round('round-0001'));
    expect(saved).toMatchObject({
      sessionId: 'session-aaaa1111', roundNumber: 1, difficulty: 'easy', gridColumns: 4, gridRows: 4,
      moves: 12, completedPairs: 8, mismatches: 4, elapsedSeconds: 40, completed: true,
      policyBand: 'strong', decisionStatus: 'pending', decision: null,
    });
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
    expect(Object.keys(saved).join()).not.toMatch(/name|email|user/i);
  });

  it('assigns consecutive round numbers per session', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    expect([1, 2, 3].map((n) => store.insertRound('session-aaaa1111', round(`round-000${n}`)).roundNumber)).toEqual([1, 2, 3]);
  });

  it('records a decision with source, reason, performance and model', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    store.insertRound('session-aaaa1111', round('round-0001'));
    const decided = store.recordDecision('session-aaaa1111', 'round-0001', decision)!;
    expect(decided.decisionStatus).toBe('decided');
    expect(decided.decision).toEqual({ nextDifficulty: 'medium', source: 'gemini', performance: 'strong', reason: 'Strong round overall.' });
    expect(decided.model).toBe('m');
    expect(decided.decidedAt).not.toBeNull();
  });

  it('never overwrites a decided round, and failure marks do not either', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    store.insertRound('session-aaaa1111', round('round-0001'));
    store.recordDecision('session-aaaa1111', 'round-0001', decision);
    store.recordDecision('session-aaaa1111', 'round-0001', { ...decision, nextDifficulty: 'hard', reason: 'Changed later.' });
    const after = store.markFailed('session-aaaa1111', 'round-0001', 'timeout')!;
    expect(after.decision?.nextDifficulty).toBe('medium');
    expect(after.decisionStatus).toBe('decided');
  });

  it('can mark a round failed and then decide it on a retry', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    store.insertRound('session-aaaa1111', round('round-0001'));
    expect(store.markFailed('session-aaaa1111', 'round-0001', 'timeout')).toMatchObject({ decisionStatus: 'failed', failureCode: 'timeout' });
    expect(store.recordDecision('session-aaaa1111', 'round-0001', decision)).toMatchObject({ decisionStatus: 'decided', failureCode: null });
  });
});

describe('integrity', () => {
  it('rejects a duplicate client round ID inside a session (database constraint)', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    store.insertRound('session-aaaa1111', round('round-0001'));
    expect(() => store.insertRound('session-aaaa1111', round('round-0001'))).toThrow();
    expect(store.listRounds('session-aaaa1111')).toHaveLength(1);
  });

  it('allows the same client round ID in different sessions', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    store.createSession('session-bbbb2222');
    store.insertRound('session-aaaa1111', round('round-0001'));
    expect(() => store.insertRound('session-bbbb2222', round('round-0001'))).not.toThrow();
  });

  it('refuses rounds for a session that does not exist (foreign key)', () => {
    expect(() => mem().insertRound('session-missing1', round('round-0001'))).toThrow();
  });

  it('enforces the per-session round limit', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    for (let i = 0; i < MAX_ROUNDS_PER_SESSION; i++) store.insertRound('session-aaaa1111', round(`round-${i}-xxxx`));
    expect(() => store.insertRound('session-aaaa1111', round('round-overflow'))).toThrow(StoreError);
  });

  it('treats hostile IDs as plain data (parameterised queries)', () => {
    const store = mem();
    const evil = "x'; DROP TABLE rounds; --";
    store.createSession(evil);
    store.createSession('session-aaaa1111');
    store.insertRound(evil, round('round-0001'));
    expect(store.listRounds(evil)).toHaveLength(1);
    expect(store.listRounds('session-aaaa1111')).toHaveLength(0);
    expect(store.sessionExists("' OR '1'='1")).toBe(false);
    expect(() => store.insertRound('session-aaaa1111', round('round-0002'))).not.toThrow();
  });
});

describe('history and isolation', () => {
  it('lists rounds oldest first and keeps sessions separate', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    store.createSession('session-bbbb2222');
    store.insertRound('session-aaaa1111', round('round-0001'));
    store.insertRound('session-bbbb2222', round('round-0002', { moves: 30 }));
    store.insertRound('session-aaaa1111', round('round-0003', { moves: 14 }));
    expect(store.listRounds('session-aaaa1111').map((r) => [r.roundNumber, r.moves])).toEqual([[1, 12], [2, 14]]);
    expect(store.listRounds('session-bbbb2222').map((r) => r.moves)).toEqual([30]);
    expect(store.getRound('session-bbbb2222', 'round-0001')).toBeNull();
  });

  it('with a limit returns the newest rounds, still oldest first', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    for (let i = 1; i <= 5; i++) store.insertRound('session-aaaa1111', round(`round-000${i}`));
    expect(store.listRounds('session-aaaa1111', 2).map((r) => r.roundNumber)).toEqual([4, 5]);
  });

  it('deleting a session removes its rounds and leaves others', () => {
    const store = mem();
    store.createSession('session-aaaa1111');
    store.createSession('session-bbbb2222');
    store.insertRound('session-aaaa1111', round('round-0001'));
    store.insertRound('session-bbbb2222', round('round-0002'));
    expect(store.deleteSession('session-aaaa1111')).toBe(true);
    expect(store.sessionExists('session-aaaa1111')).toBe(false);
    expect(store.listRounds('session-aaaa1111')).toEqual([]);
    expect(store.listRounds('session-bbbb2222')).toHaveLength(1);
    expect(store.deleteSession('session-aaaa1111')).toBe(false);
  });
});

describe('persistence across a backend restart', () => {
  it('keeps sessions, rounds and decisions in a file database after closing and reopening', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-game-'));
    dirs.push(dir);
    const file = join(dir, 'nested', 'game.sqlite'); // also proves the folder is created

    const first = openStore(file);
    first.createSession('session-aaaa1111');
    first.insertRound('session-aaaa1111', round('round-0001'));
    first.recordDecision('session-aaaa1111', 'round-0001', decision);
    first.insertRound('session-aaaa1111', round('round-0002', { moves: 20 }));
    first.close();

    const second = openStore(file); // "restart"
    open.push(second);
    expect(second.sessionExists('session-aaaa1111')).toBe(true);
    const rounds = second.listRounds('session-aaaa1111');
    expect(rounds.map((r) => [r.roundNumber, r.decisionStatus])).toEqual([[1, 'decided'], [2, 'pending']]);
    expect(rounds[0]!.decision?.reason).toBe('Strong round overall.');
    expect(second.insertRound('session-aaaa1111', round('round-0003')).roundNumber).toBe(3);
  });
});
