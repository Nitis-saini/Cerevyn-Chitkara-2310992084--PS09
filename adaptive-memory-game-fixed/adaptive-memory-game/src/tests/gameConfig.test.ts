import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_POLICY,
  CARD_SYMBOLS,
  DIFFICULTY_CONFIG,
  DIFFICULTY_ORDER,
} from '../config/gameConfig';

describe('difficulty configuration', () => {
  it.each([
    ['easy', 4, 4, 8, 16],
    ['medium', 5, 4, 10, 20],
    ['hard', 6, 6, 18, 36],
  ] as const)('%s is %i columns x %i rows with %i pairs (%i cards)', (level, cols, rows, pairs, cards) => {
    const config = DIFFICULTY_CONFIG[level];
    expect(config.columns).toBe(cols);
    expect(config.rows).toBe(rows);
    expect(config.pairCount).toBe(pairs);
    expect(config.columns * config.rows).toBe(cards);
  });

  it.each([
    ['easy', 24, 90],
    ['medium', 35, 150],
    ['hard', 60, 300],
  ] as const)('%s targets are %i moves and %i seconds', (level, moves, seconds) => {
    expect(DIFFICULTY_CONFIG[level].targets).toEqual({ maxMoves: moves, maxSeconds: seconds });
  });

  it('gives more moves and more time at every higher level', () => {
    const [easy, medium, hard] = DIFFICULTY_ORDER.map((d) => DIFFICULTY_CONFIG[d].targets);
    expect(medium!.maxMoves).toBeGreaterThan(easy!.maxMoves);
    expect(hard!.maxMoves).toBeGreaterThan(medium!.maxMoves);
    expect(medium!.maxSeconds).toBeGreaterThan(easy!.maxSeconds);
    expect(hard!.maxSeconds).toBeGreaterThan(medium!.maxSeconds);
  });

  it('keeps grid area equal to twice the pair count for every level', () => {
    for (const level of DIFFICULTY_ORDER) {
      const { columns, rows, pairCount } = DIFFICULTY_CONFIG[level];
      expect(columns * rows).toBe(pairCount * 2);
    }
  });

  it('has enough unique symbols for the largest board', () => {
    const maxPairs = Math.max(...DIFFICULTY_ORDER.map((d) => DIFFICULTY_CONFIG[d].pairCount));
    expect(CARD_SYMBOLS.length).toBeGreaterThanOrEqual(maxPairs);
    expect(new Set(CARD_SYMBOLS.map((s) => s.id)).size).toBe(CARD_SYMBOLS.length);
    expect(new Set(CARD_SYMBOLS.map((s) => s.symbol)).size).toBe(CARD_SYMBOLS.length);
  });

  it('starts on Easy and the policy only references configured levels', () => {
    expect(ADAPTIVE_POLICY.initialDifficulty).toBe('easy');
    expect(ADAPTIVE_POLICY.onTargetsMet).toEqual({ easy: 'medium', medium: 'hard', hard: 'hard' });
    expect(ADAPTIVE_POLICY.onTargetsMissed).toEqual({ easy: 'easy', medium: 'easy', hard: 'easy' });
    for (const level of DIFFICULTY_ORDER) {
      expect(DIFFICULTY_ORDER).toContain(ADAPTIVE_POLICY.onTargetsMet[level]);
      expect(DIFFICULTY_ORDER).toContain(ADAPTIVE_POLICY.onTargetsMissed[level]);
    }
  });
});
