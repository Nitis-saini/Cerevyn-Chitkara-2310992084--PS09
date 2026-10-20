import { describe, expect, it } from 'vitest';
import { DIFFICULTY_CONFIG, DIFFICULTY_ORDER, PERFORMANCE_POLICY } from '../config/gameConfig';
import type { Difficulty } from '../types/game';
import { statsForRound } from '../utils/roundStats';
import {
  allowedNextDifficulties,
  classifyRound,
  computeMetrics,
  consecutiveInBand,
  fallbackDecision,
  ratingFitsMove,
  stepDown,
  stepUp,
} from '../utils/performancePolicy';

/** A completed round (every pair matched) at `level`. */
const round = (level: Difficulty, moves: number, seconds: number) =>
  statsForRound(level, moves, DIFFICULTY_CONFIG[level].pairCount, seconds);

describe('policy configuration', () => {
  it('uses documented, sane thresholds', () => {
    expect(PERFORMANCE_POLICY.strongBudgetRatio).toBeGreaterThan(0);
    expect(PERFORMANCE_POLICY.strongBudgetRatio).toBeLessThan(1);
    expect(PERFORMANCE_POLICY.strongMaxMismatchRate).toBeLessThanOrEqual(1);
    expect(PERFORMANCE_POLICY.forcedMoveAfterRounds).toBeGreaterThanOrEqual(2);
  });
});

describe('computeMetrics', () => {
  it('derives per-pair and budget metrics in code', () => {
    expect(computeMetrics(round('easy', 12, 45))).toEqual({
      movesPerPair: 1.5,
      secondsPerPair: 5.63,
      mismatchRate: 0.33,
      moveBudgetUsed: 0.5,
      timeBudgetUsed: 0.5,
    });
  });
});

describe('classifyRound at every threshold boundary', () => {
  // Easy: 24 moves / 90 s. Strong needs <= 75% of each (18 moves, 67.5 s) and <= 50% mismatches.
  it.each([
    ['easy', 16, 60, 'strong'], // 8 mismatches / 16 moves = exactly 0.5
    ['easy', 17, 60, 'mixed'], //  9 / 17 = 0.53 > 0.5
    ['easy', 12, 67, 'strong'],
    ['easy', 12, 68, 'mixed'], // 68 s > 67.5 s
    ['easy', 24, 90, 'mixed'], //  targets met exactly: not weak
    ['easy', 25, 40, 'weak'], //   one move over
    ['easy', 10, 91, 'weak'], //   one second over
    // Medium: 35 / 150. Strong <= 26.25 moves, 112.5 s.
    ['medium', 20, 100, 'strong'], // 10 mismatches / 20 = 0.5
    ['medium', 21, 100, 'mixed'],
    ['medium', 15, 112, 'strong'],
    ['medium', 15, 113, 'mixed'],
    ['medium', 35, 150, 'mixed'],
    ['medium', 36, 100, 'weak'],
    ['medium', 15, 151, 'weak'],
    // Hard: 60 / 300. Strong <= 45 moves, 225 s.
    ['hard', 36, 200, 'strong'], // 18 / 36 = 0.5
    ['hard', 37, 200, 'mixed'],
    ['hard', 30, 225, 'strong'],
    ['hard', 30, 226, 'mixed'],
    ['hard', 60, 300, 'mixed'],
    ['hard', 61, 100, 'weak'],
    ['hard', 40, 301, 'weak'],
  ] as const)('%s with %s moves in %s s is %s', (level, moves, seconds, expected) => {
    expect(classifyRound(round(level, moves, seconds))).toBe(expected);
  });
});

describe('stepUp / stepDown', () => {
  it('moves one level and clamps at both ends', () => {
    expect(stepUp('easy')).toBe('medium');
    expect(stepUp('medium')).toBe('hard');
    expect(stepUp('hard')).toBe('hard');
    expect(stepDown('hard')).toBe('medium');
    expect(stepDown('medium')).toBe('easy');
    expect(stepDown('easy')).toBe('easy');
  });
});

describe('allowedNextDifficulties', () => {
  it.each([
    ['strong', 'easy', ['easy', 'medium']],
    ['strong', 'medium', ['medium', 'hard']],
    ['strong', 'hard', ['hard']],
    ['mixed', 'easy', ['easy']],
    ['mixed', 'medium', ['medium']],
    ['mixed', 'hard', ['hard']],
    ['weak', 'hard', ['medium', 'hard']],
    ['weak', 'medium', ['easy', 'medium']],
    ['weak', 'easy', ['easy']],
  ] as const)('first %s round on %s allows %j', (band, level, expected) => {
    const { allowed, forced } = allowedNextDifficulties(level, band, []);
    expect([...allowed].sort()).toEqual([...expected].sort());
    expect(forced).toBe(false);
  });

  it('never allows skipping a level, for any band and level', () => {
    for (const level of DIFFICULTY_ORDER) {
      for (const band of ['strong', 'mixed', 'weak'] as const) {
        for (const next of allowedNextDifficulties(level, band, []).allowed) {
          expect(Math.abs(DIFFICULTY_ORDER.indexOf(next) - DIFFICULTY_ORDER.indexOf(level))).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('forces a move after repeated strong rounds so the player cannot be stuck', () => {
    const earlier = [{ difficulty: 'easy', policyBand: 'strong' }] as const;
    expect(allowedNextDifficulties('easy', 'strong', earlier)).toEqual({ allowed: ['medium'], forced: true });
  });

  it('forces a move down after repeated weak rounds', () => {
    const earlier = [{ difficulty: 'medium', policyBand: 'weak' }] as const;
    expect(allowedNextDifficulties('medium', 'weak', earlier)).toEqual({ allowed: ['easy'], forced: true });
  });

  it('clamps a forced move at the ends of the ladder', () => {
    expect(allowedNextDifficulties('hard', 'strong', [{ difficulty: 'hard', policyBand: 'strong' }]).allowed).toEqual(['hard']);
    expect(allowedNextDifficulties('easy', 'weak', [{ difficulty: 'easy', policyBand: 'weak' }]).allowed).toEqual(['easy']);
  });

  it('does not force when the earlier round was at another level or in another band', () => {
    expect(allowedNextDifficulties('medium', 'strong', [{ difficulty: 'easy', policyBand: 'strong' }]).forced).toBe(false);
    expect(allowedNextDifficulties('easy', 'strong', [{ difficulty: 'easy', policyBand: 'mixed' }]).forced).toBe(false);
  });

  it('mixed rounds are never forced', () => {
    const earlier = [
      { difficulty: 'easy', policyBand: 'mixed' },
      { difficulty: 'easy', policyBand: 'mixed' },
    ] as const;
    expect(allowedNextDifficulties('easy', 'mixed', earlier)).toEqual({ allowed: ['easy'], forced: false });
  });
});

describe('consecutiveInBand', () => {
  it('counts the current round plus the matching tail of earlier rounds', () => {
    const earlier = [
      { difficulty: 'easy', policyBand: 'weak' },
      { difficulty: 'easy', policyBand: 'strong' },
      { difficulty: 'easy', policyBand: 'strong' },
    ] as const;
    expect(consecutiveInBand('easy', 'strong', earlier)).toBe(3);
    expect(consecutiveInBand('easy', 'weak', earlier)).toBe(1);
    expect(consecutiveInBand('easy', 'strong', [])).toBe(1);
  });
});

describe('ratingFitsMove', () => {
  it('requires strong/good to go up and weak to go down', () => {
    expect(ratingFitsMove('easy', 'medium', 'strong')).toBe(true);
    expect(ratingFitsMove('easy', 'medium', 'good')).toBe(true);
    expect(ratingFitsMove('easy', 'medium', 'mixed')).toBe(false);
    expect(ratingFitsMove('easy', 'medium', 'weak')).toBe(false);
    expect(ratingFitsMove('hard', 'medium', 'weak')).toBe(true);
    expect(ratingFitsMove('hard', 'medium', 'strong')).toBe(false);
    expect(ratingFitsMove('medium', 'medium', 'weak')).toBe(true);
  });
});

describe('fallbackDecision (documented rule, never AI)', () => {
  it('moves up one level after a strong round and explains why', () => {
    const d = fallbackDecision(round('easy', 12, 40));
    expect(d.nextDifficulty).toBe('medium');
    expect(d.reason).toContain('rules');
    expect(d.reason).toContain('12 moves');
  });

  it('moves down exactly one level after a weak round (hard -> medium, medium -> easy)', () => {
    expect(fallbackDecision(round('hard', 70, 200)).nextDifficulty).toBe('medium');
    expect(fallbackDecision(round('medium', 40, 100)).nextDifficulty).toBe('easy');
  });

  it('stays after a mixed round and at the ends of the ladder', () => {
    expect(fallbackDecision(round('medium', 30, 140)).nextDifficulty).toBe('medium');
    expect(fallbackDecision(round('hard', 30, 100)).nextDifficulty).toBe('hard');
    expect(fallbackDecision(round('easy', 30, 100)).nextDifficulty).toBe('easy');
  });

  it('every decision has a non-empty explanation', () => {
    for (const level of DIFFICULTY_ORDER) {
      for (const [m, s] of [[10, 10], [DIFFICULTY_CONFIG[level].targets.maxMoves, 10], [999, 9999]] as const) {
        expect(fallbackDecision(round(level, Math.max(m, DIFFICULTY_CONFIG[level].pairCount), s)).reason.length).toBeGreaterThan(20);
      }
    }
  });
});
