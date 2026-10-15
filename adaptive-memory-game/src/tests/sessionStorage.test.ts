import { beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_CONFIG } from '../config/gameConfig';
import type { SessionRecord } from '../types/game';
import {
  addRecord,
  clearHistory,
  getBestResults,
  isSessionRecord,
  loadHistory,
} from '../utils/sessionStorage';

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: 'abc',
  completedAt: '2026-01-02T03:04:05.000Z',
  moves: 12,
  elapsedSeconds: 40,
  difficulty: 'easy',
  nextDifficulty: 'hard',
  ...over,
});

beforeEach(() => window.localStorage.clear());

describe('session history storage', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('saves and loads records round-trip', () => {
    addRecord(record());
    addRecord(record({ moves: 15, nextDifficulty: 'easy' }));
    const loaded = loadHistory();
    expect(loaded).toHaveLength(2);
    expect(loaded[1]).toMatchObject({ moves: 15, nextDifficulty: 'easy' });
  });

  it('keeps only the newest records up to the configured maximum', () => {
    for (let i = 1; i <= HISTORY_CONFIG.maxStoredResults + 5; i++) addRecord(record({ moves: i }));
    const loaded = loadHistory();
    expect(loaded).toHaveLength(HISTORY_CONFIG.maxStoredResults);
    expect(loaded.at(-1)?.moves).toBe(HISTORY_CONFIG.maxStoredResults + 5);
  });

  it('clears history', () => {
    addRecord(record());
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['a JSON object instead of an array', '{"a":1}'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
  ])('survives corrupted data: %s', (_name, raw) => {
    window.localStorage.setItem(HISTORY_CONFIG.storageKey, raw);
    expect(loadHistory()).toEqual([]);
  });

  it('drops invalid entries but keeps valid ones', () => {
    window.localStorage.setItem(
      HISTORY_CONFIG.storageKey,
      JSON.stringify([record(), { moves: 'many' }, null, 7, record({ moves: -3 }), record({ difficulty: 'nightmare' as never })]),
    );
    expect(loadHistory()).toEqual([record()]);
  });

  it('does not crash when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadHistory(broken)).toEqual([]);
    expect(() => addRecord(record(), broken)).not.toThrow();
    expect(() => clearHistory(broken)).not.toThrow();
    expect(loadHistory(null)).toEqual([]);
  });
});

describe('isSessionRecord', () => {
  it('accepts a valid record', () => expect(isSessionRecord(record())).toBe(true));
  it('accepts every configured difficulty', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      expect(isSessionRecord(record({ difficulty: d, nextDifficulty: d }))).toBe(true);
    }
  });
  it.each([['toString'], ['constructor'], ['__proto__']])('rejects prototype key %s as a difficulty', (key) => {
    expect(isSessionRecord(record({ difficulty: key as never }))).toBe(false);
  });
  it.each([
    ['empty sessionId', record({ sessionId: '' })],
    ['bad date', record({ completedAt: 'yesterday-ish' })],
    ['fractional moves', record({ moves: 1.5 })],
    ['negative time', record({ elapsedSeconds: -1 })],
    ['NaN time', record({ elapsedSeconds: NaN })],
  ])('rejects %s', (_n, value) => expect(isSessionRecord(value)).toBe(false));
});

describe('getBestResults', () => {
  it('returns nulls for no records', () => {
    expect(getBestResults([])).toEqual({ bestSeconds: null, bestMoves: null });
  });
  it('finds the lowest time and fewest moves independently', () => {
    const best = getBestResults([record({ moves: 12, elapsedSeconds: 50 }), record({ moves: 14, elapsedSeconds: 31 })]);
    expect(best).toEqual({ bestSeconds: 31, bestMoves: 12 });
  });
});
