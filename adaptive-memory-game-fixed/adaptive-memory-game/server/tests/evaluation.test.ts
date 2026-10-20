// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY_CONFIG, DIFFICULTY_ORDER } from '../../src/config/gameConfig';
import type { Difficulty } from '../../src/types/game';
import { statsForRound } from '../../src/utils/roundStats';
import { ModelError, type LlmGenerate } from '../llm';
import {
  buildDecisionPrompt,
  buildLlmEvaluationContext,
  evaluateWithGemini,
  parseDecision,
} from '../evaluation';

const stats = (level: Difficulty, moves: number, seconds: number) =>
  statsForRound(level, moves, DIFFICULTY_CONFIG[level].pairCount, seconds);

const ctxFor = (level: Difficulty, moves: number, seconds: number) => {
  const s = stats(level, moves, seconds);
  return buildLlmEvaluationContext(s, []);
};

/** Well-formed model reply for any next difficulty. */
const reply = (ctx: ReturnType<typeof ctxFor>, nextDifficulty: Difficulty, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    nextDifficulty,
    reason: 'The player completed the round efficiently, justifying the difficulty change.',
    metricsSummary: {
      moves: ctx.stats.moves,
      elapsedActiveSeconds: ctx.stats.elapsedSeconds,
      completedPairs: ctx.stats.completedPairs,
    },
    ...over,
  });

describe('buildDecisionPrompt', () => {
  it('includes raw stats but NO policy thresholds, NO allowedNextDifficulties, NO mustMove', () => {
    const ctx = ctxFor('easy', 12, 40);
    const payload = JSON.parse(buildDecisionPrompt(ctx).user);

    expect(payload.currentRound).toMatchObject({
      difficulty: 'easy', grid: '4x4', totalPairs: 8, completedPairs: 8,
      moves: 12, mismatches: 4, elapsedActiveSeconds: 40, completed: true,
    });
    expect(payload.currentRound).toHaveProperty('accuracy');

    // Policy constraints must NOT be present
    expect(payload).not.toHaveProperty('policyBand');
    expect(payload).not.toHaveProperty('allowedNextDifficulties');
    expect(payload).not.toHaveProperty('mustMove');
    expect(payload).not.toHaveProperty('thresholds');
    expect(payload).not.toHaveProperty('targetsForThisLevel');
    expect(payload).not.toHaveProperty('derived');

    // Level descriptions are included for context
    expect(Object.keys(payload.levels)).toEqual(['easy', 'medium', 'hard']);

    // No personal data
    expect(JSON.stringify(payload)).not.toMatch(/sessionId|clientRoundId|createdAt/);
  });

  it('declares a JSON schema limited to configured levels (no performance/rating field)', () => {
    const schema = buildDecisionPrompt(ctxFor('easy', 12, 40)).schema as {
      properties: { nextDifficulty: { enum: string[] }; performance?: unknown };
    };
    expect(schema.properties.nextDifficulty.enum).toEqual(['easy', 'medium', 'hard']);
    expect(schema.properties).not.toHaveProperty('performance');
  });

  it('includes recent rounds from history for trend analysis', () => {
    const hist = [
      { roundNumber: 1, difficulty: 'easy' as Difficulty, gridColumns: 4, gridRows: 4, moves: 20, mismatches: 5, elapsedSeconds: 80, decision: { nextDifficulty: 'easy' as Difficulty, source: 'gemini' as const, performance: null, reason: 'x' }, policyBand: 'weak' as const, decisionStatus: 'decided' as const, sessionId: 's', clientRoundId: 'r1', pairCount: 8, completedPairs: 8, completed: true, failureCode: null, model: 'm', createdAt: '2026-01-01T00:00:00.000Z', decidedAt: null },
    ];
    const ctx = buildLlmEvaluationContext(stats('easy', 12, 40), hist);
    const payload = JSON.parse(buildDecisionPrompt(ctx).user);
    expect(payload.recentRounds).toHaveLength(1);
    expect(payload.recentRounds[0]).toMatchObject({ round: 1, difficulty: 'easy', moves: 20 });
  });

  it('history window is capped at 5 recent rounds', () => {
    const mkRound = (n: number) => ({
      roundNumber: n, difficulty: 'easy' as Difficulty, gridColumns: 4, gridRows: 4,
      moves: 12, mismatches: 4, elapsedSeconds: 40, decision: null, policyBand: 'mixed' as const,
      decisionStatus: 'pending' as const, sessionId: 's', clientRoundId: `r${n}`, pairCount: 8,
      completedPairs: 8, completed: true, failureCode: null, model: null,
      createdAt: '2026-01-01T00:00:00.000Z', decidedAt: null,
    });
    const hist = [1, 2, 3, 4, 5, 6, 7].map(mkRound);
    const ctx = buildLlmEvaluationContext(stats('easy', 12, 40), hist);
    const payload = JSON.parse(buildDecisionPrompt(ctx).user);
    expect(payload.recentRounds).toHaveLength(5);
    expect(payload.recentRounds.map((r: { round: number }) => r.round)).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('parseDecision: LLM may freely choose any valid difficulty', () => {
  it('accepts moving from easy directly to hard (no level-skip restriction)', () => {
    const ctx = ctxFor('easy', 12, 40);
    const result = parseDecision(reply(ctx, 'hard'), ctx);
    expect(result.nextDifficulty).toBe('hard');
  });

  it('accepts moving from hard to easy (not just one step)', () => {
    const ctx = ctxFor('hard', 70, 200);
    const result = parseDecision(reply(ctx, 'easy'), ctx);
    expect(result.nextDifficulty).toBe('easy');
  });

  it('accepts staying on the same level regardless of performance', () => {
    for (const level of DIFFICULTY_ORDER) {
      const ctx = ctxFor(level, 12, 40);
      expect(parseDecision(reply(ctx, level), ctx).nextDifficulty).toBe(level);
    }
  });

  it('accepts moving up from easy to medium', () => {
    const ctx = ctxFor('easy', 12, 40);
    expect(parseDecision(reply(ctx, 'medium'), ctx).nextDifficulty).toBe('medium');
  });

  it('accepts moving down from medium to easy', () => {
    const ctx = ctxFor('medium', 40, 160);
    expect(parseDecision(reply(ctx, 'easy'), ctx).nextDifficulty).toBe('easy');
  });

  it('does NOT apply a performance/rating check — reason field is free form', () => {
    const ctx = ctxFor('easy', 12, 40);
    // Previously this would require "strong" or "good" to go up; now it only validates reason length
    const raw = JSON.stringify({
      nextDifficulty: 'medium',
      reason: 'The player showed solid improvement across all metrics.',
      metricsSummary: { moves: 12, elapsedActiveSeconds: 40, completedPairs: 8 },
    });
    expect(parseDecision(raw, ctx).nextDifficulty).toBe('medium');
  });
});

describe('parseDecision: malformed output', () => {
  const ctx = ctxFor('easy', 12, 40);
  const good = JSON.parse(reply(ctx, 'medium'));

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['prose', 'I recommend medium.'],
    ['array', '[]'],
    ['unknown level', JSON.stringify({ ...good, nextDifficulty: 'nightmare' })],
    ['prototype key as level', JSON.stringify({ ...good, nextDifficulty: 'toString' })],
    ['missing level', JSON.stringify({ ...good, nextDifficulty: undefined })],
    ['missing reason', JSON.stringify({ ...good, reason: undefined })],
    ['blank reason', JSON.stringify({ ...good, reason: '    ' })],
    ['too short reason', JSON.stringify({ ...good, reason: 'ok' })],
    ['oversized reason', JSON.stringify({ ...good, reason: 'x'.repeat(601) })],
    ['missing metricsSummary', JSON.stringify({ ...good, metricsSummary: undefined })],
    ['wrong moves', JSON.stringify({ ...good, metricsSummary: { ...good.metricsSummary, moves: 13 } })],
    ['wrong seconds', JSON.stringify({ ...good, metricsSummary: { ...good.metricsSummary, elapsedActiveSeconds: 41 } })],
    ['wrong pairs', JSON.stringify({ ...good, metricsSummary: { ...good.metricsSummary, completedPairs: 7 } })],
    ['string metric', JSON.stringify({ ...good, metricsSummary: { ...good.metricsSummary, moves: '12' } })],
  ])('rejects %s as invalid_response', (_name, raw) => {
    expect(() => parseDecision(raw as string | undefined, ctx)).toThrow(
      expect.objectContaining({ code: 'invalid_response' }),
    );
  });

  it('does not accept extra control fields (ignored safely)', () => {
    const parsed = parseDecision(JSON.stringify({ ...good, mismatchDelayMs: 0, code: 'alert(1)' }), ctx);
    expect(Object.keys(parsed).sort()).toEqual(['nextDifficulty', 'reason']);
  });
});

describe('evaluateWithGemini: free-form LLM authority', () => {
  const deps = (generate: LlmGenerate, over: Partial<{ timeoutMs: number; configured: boolean }> = {}) => ({
    generate, timeoutMs: 500, configured: true, ...over,
  });

  it('returns the validated decision from the model without policy checks', async () => {
    const ctx = ctxFor('easy', 12, 40);
    const generate = vi.fn(async () => reply(ctx, 'hard')); // skips a level — now valid
    const result = await evaluateWithGemini(ctx, deps(generate));
    expect(result.nextDifficulty).toBe('hard');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('fails with not_configured without calling the model', async () => {
    const generate = vi.fn(async () => 'x');
    await expect(evaluateWithGemini(ctxFor('easy', 12, 40), deps(generate, { configured: false }))).rejects.toMatchObject({ code: 'not_configured' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('times out a model that never answers', async () => {
    await expect(evaluateWithGemini(ctxFor('easy', 12, 40), deps(() => new Promise<string>(() => {}), { timeoutMs: 30 }))).rejects.toMatchObject({ code: 'timeout' });
  });

  it('aborts the model call when it times out', async () => {
    let aborted = false;
    const generate: LlmGenerate = (_p, signal) =>
      new Promise<string>(() => signal.addEventListener('abort', () => (aborted = true)));
    await expect(evaluateWithGemini(ctxFor('easy', 12, 40), deps(generate, { timeoutMs: 20 }))).rejects.toMatchObject({ code: 'timeout' });
    expect(aborted).toBe(true);
  });

  it('maps provider failures without exposing their text', async () => {
    const ctx = ctxFor('easy', 12, 40);
    const err = await evaluateWithGemini(ctx, deps(async () => { throw new Error('secret provider details'); })).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.code).toBe('service_error');
    expect(err.message).not.toContain('secret');
  });

  it('maps a provider 429 to rate_limited', async () => {
    const ctx = ctxFor('easy', 12, 40);
    await expect(evaluateWithGemini(ctx, deps(async () => { throw Object.assign(new Error('x'), { status: 429 }); }))).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('rejects an unknown difficulty level even if the LLM insists on it', async () => {
    const ctx = ctxFor('easy', 12, 40);
    const raw = JSON.stringify({
      nextDifficulty: 'expert',
      reason: 'Player is ready for a harder challenge beyond hard.',
      metricsSummary: { moves: 12, elapsedActiveSeconds: 40, completedPairs: 8 },
    });
    await expect(evaluateWithGemini(ctx, deps(async () => raw))).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
