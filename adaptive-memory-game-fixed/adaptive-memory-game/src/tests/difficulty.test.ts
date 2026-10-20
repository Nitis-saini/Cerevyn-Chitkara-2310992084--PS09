import { describe, expect, it } from 'vitest';
import { DIFFICULTY_CONFIG } from '../config/gameConfig';
import { evaluateRound } from '../utils/difficulty';

const { easy, medium, hard } = {
  easy: DIFFICULTY_CONFIG.easy.targets,
  medium: DIFFICULTY_CONFIG.medium.targets,
  hard: DIFFICULTY_CONFIG.hard.targets,
};

describe('evaluateRound: Easy rounds', () => {
  it('promotes to Medium when both targets are met, and says why', () => {
    const d = evaluateRound({ difficulty: 'easy', moves: 17, elapsedSeconds: 42 });
    expect(d.nextDifficulty).toBe('medium');
    expect(d.targetsMet).toBe(true);
    expect(d.message).toContain('17 moves and 42 seconds');
    expect(d.message).toContain('Your next round will be Medium (5×4 grid, 10 pairs)');
    expect(d.message).toContain('met both Easy targets');
  });

  it('passes exactly at both boundaries (inclusive)', () => {
    expect(evaluateRound({ difficulty: 'easy', moves: easy.maxMoves, elapsedSeconds: easy.maxSeconds }).nextDifficulty).toBe('medium');
  });

  it('stays Easy one move over the limit', () => {
    const d = evaluateRound({ difficulty: 'easy', moves: easy.maxMoves + 1, elapsedSeconds: 10 });
    expect(d.nextDifficulty).toBe('easy');
    expect(d.movesWithinTarget).toBe(false);
    expect(d.timeWithinTarget).toBe(true);
    expect(d.message).toContain('Your next round will be Easy (4×4 grid, 8 pairs)');
    expect(d.message).toContain('exceeded the move limit');
  });

  it('stays Easy one second over the limit', () => {
    const d = evaluateRound({ difficulty: 'easy', moves: 10, elapsedSeconds: easy.maxSeconds + 1 });
    expect(d.nextDifficulty).toBe('easy');
    expect(d.timeWithinTarget).toBe(false);
    expect(d.message).toContain('exceeded the time limit');
  });

  it('says so when both limits are exceeded', () => {
    const d = evaluateRound({ difficulty: 'easy', moves: 40, elapsedSeconds: 200 });
    expect(d.nextDifficulty).toBe('easy');
    expect(d.message).toContain('exceeded both');
  });
});

describe('evaluateRound: Medium rounds', () => {
  it('promotes to Hard when both Medium targets are met', () => {
    const d = evaluateRound({ difficulty: 'medium', moves: 15, elapsedSeconds: 70 });
    expect(d.nextDifficulty).toBe('hard');
    expect(d.message).toContain('Your next round will be Hard (6×6 grid, 18 pairs)');
    expect(d.message).toContain('met both Medium targets');
  });

  it('passes exactly at the Medium boundaries', () => {
    expect(evaluateRound({ difficulty: 'medium', moves: medium.maxMoves, elapsedSeconds: medium.maxSeconds }).nextDifficulty).toBe('hard');
  });

  it('drops to Easy one move or one second over the Medium limit', () => {
    expect(evaluateRound({ difficulty: 'medium', moves: medium.maxMoves + 1, elapsedSeconds: 10 }).nextDifficulty).toBe('easy');
    expect(evaluateRound({ difficulty: 'medium', moves: 12, elapsedSeconds: medium.maxSeconds + 1 }).nextDifficulty).toBe('easy');
  });
});

describe('evaluateRound: Hard rounds', () => {
  it('stays Hard when the Hard targets are met (top level)', () => {
    const d = evaluateRound({ difficulty: 'hard', moves: 30, elapsedSeconds: 120 });
    expect(d.nextDifficulty).toBe('hard');
    expect(d.message).toContain('Your next round will be Hard (6×6 grid, 18 pairs)');
    expect(d.message).toContain('met both Hard targets');
  });

  it('passes exactly at the Hard boundaries', () => {
    expect(evaluateRound({ difficulty: 'hard', moves: hard.maxMoves, elapsedSeconds: hard.maxSeconds }).nextDifficulty).toBe('hard');
  });

  it('drops to Easy one move over the Hard limit', () => {
    const d = evaluateRound({ difficulty: 'hard', moves: hard.maxMoves + 1, elapsedSeconds: 20 });
    expect(d.nextDifficulty).toBe('easy');
    expect(d.message).toContain('Your next round will be Easy (4×4 grid, 8 pairs)');
  });

  it('drops to Easy one second over the Hard limit', () => {
    expect(evaluateRound({ difficulty: 'hard', moves: 20, elapsedSeconds: hard.maxSeconds + 1 }).nextDifficulty).toBe('easy');
  });
});

describe('evaluateRound: configurability and wording', () => {
  it('uses the thresholds it is given', () => {
    const custom = {
      ...DIFFICULTY_CONFIG,
      easy: { ...DIFFICULTY_CONFIG.easy, targets: { maxMoves: 9, maxSeconds: 15 } },
    };
    expect(evaluateRound({ difficulty: 'easy', moves: 9, elapsedSeconds: 15 }, custom).nextDifficulty).toBe('medium');
    expect(evaluateRound({ difficulty: 'easy', moves: 10, elapsedSeconds: 15 }, custom).nextDifficulty).toBe('easy');
  });

  it('uses singular wording for 1 second', () => {
    expect(evaluateRound({ difficulty: 'easy', moves: 8, elapsedSeconds: 1 }).message).toContain('1 second.');
  });
});

describe('evaluateRound: exact new targets (literal numbers)', () => {
  it.each([
    // level, moves, seconds, expected next
    ['easy', 24, 90, 'medium'],
    ['easy', 25, 90, 'easy'],
    ['easy', 24, 91, 'easy'],
    ['easy', 8, 0, 'medium'],
    ['medium', 35, 150, 'hard'],
    ['medium', 36, 150, 'easy'],
    ['medium', 35, 151, 'easy'],
    ['hard', 60, 300, 'hard'],
    ['hard', 61, 300, 'easy'],
    ['hard', 60, 301, 'easy'],
    ['hard', 18, 1, 'hard'],
  ] as const)('%s round: %i moves, %i s -> next %s', (difficulty, moves, elapsedSeconds, next) => {
    expect(evaluateRound({ difficulty, moves, elapsedSeconds }).nextDifficulty).toBe(next);
  });

  it('a result that fails Easy on moves would pass Medium and Hard (limits grow)', () => {
    expect(evaluateRound({ difficulty: 'easy', moves: 30, elapsedSeconds: 60 }).nextDifficulty).toBe('easy');
    expect(evaluateRound({ difficulty: 'medium', moves: 30, elapsedSeconds: 60 }).nextDifficulty).toBe('hard');
    expect(evaluateRound({ difficulty: 'hard', moves: 30, elapsedSeconds: 60 }).nextDifficulty).toBe('hard');
  });

  it('states the limits in the explanation', () => {
    const met = evaluateRound({ difficulty: 'medium', moves: 20, elapsedSeconds: 100 }).message;
    expect(met).toContain('35 moves or fewer and 150 seconds or less');
    const missed = evaluateRound({ difficulty: 'hard', moves: 61, elapsedSeconds: 10 }).message;
    expect(missed).toContain('exceeded the move limit (60)');
  });
});
