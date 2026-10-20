import { describe, expect, it, vi } from 'vitest';
import { createHttpRoundEvaluator, parseStoredRound } from '../services/roundApi';
import type { RoundSubmission } from '../types/game';

const SUBMISSION: RoundSubmission = {
  clientRoundId: 'round-aaaa1111', completed: true, difficulty: 'easy', gridColumns: 4, gridRows: 4,
  pairCount: 8, completedPairs: 8, moves: 12, mismatches: 4, elapsedSeconds: 40,
};
const storedRound = (over: Record<string, unknown> = {}) => ({
  sessionId: 'session-aaaa1111', roundNumber: 1, clientRoundId: 'round-aaaa1111', difficulty: 'easy',
  gridColumns: 4, gridRows: 4, pairCount: 8, completedPairs: 8, moves: 12, mismatches: 4, elapsedSeconds: 40,
  completed: true, policyBand: 'strong', decisionStatus: 'decided',
  decision: { nextDifficulty: 'medium', source: 'gemini', performance: 'strong', reason: 'Quick and accurate.' },
  failureCode: null, model: 'm', createdAt: '2026-01-01T00:00:00.000Z', decidedAt: '2026-01-01T00:00:01.000Z', ...over,
});
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const client = (fetchImpl: unknown, timeoutMs = 500) =>
  createHttpRoundEvaluator({ baseUrl: 'http://api.test', timeoutMs, fetchImpl: fetchImpl as typeof fetch });

describe('createSession', () => {
  it('returns the server-issued ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(201, { sessionId: 'session-aaaa1111' }));
    expect(await client(fetchImpl).createSession()).toEqual({ status: 'ok', sessionId: 'session-aaaa1111' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://api.test/api/sessions');
    expect(fetchImpl.mock.calls[0]![1].method).toBe('POST');
  });
  it('rejects an unsafe ID from the server', async () => {
    const r = await client(vi.fn().mockResolvedValue(json(201, { sessionId: '../x' }))).createSession();
    expect(r).toMatchObject({ status: 'unavailable', reason: 'invalid_response' });
  });
});

describe('submitRound', () => {
  it('posts only the numeric round to the session and returns the stored decision', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { round: storedRound(), replayed: false }));
    const result = await client(fetchImpl).submitRound('session-aaaa1111', SUBMISSION);
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://api.test/api/sessions/session-aaaa1111/rounds');
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toEqual(SUBMISSION);
    expect(result).toMatchObject({ status: 'ok', round: { decision: { nextDifficulty: 'medium', source: 'gemini' } } });
  });

  it.each([
    [503, 'not_configured', 'not_configured'],
    [504, 'timeout', 'timeout'],
    [429, 'rate_limited', 'rate_limited'],
    [502, 'invalid_response', 'invalid_response'],
    [502, 'service_error', 'service_error'],
    [404, 'session_not_found', 'session_not_found'],
    [409, 'round_conflict', 'round_conflict'],
    [500, 'persistence_error', 'persistence_error'],
    [400, 'invalid_request', 'invalid_request'],
  ])('maps HTTP %s (%s) to %s without a decision', async (status, error, reason) => {
    const r = await client(vi.fn().mockResolvedValue(json(status, { error, message: 'x' }))).submitRound('session-aaaa1111', SUBMISSION);
    expect(r).toMatchObject({ status: 'unavailable', reason });
    expect(r).not.toHaveProperty('round');
  });

  it('falls back to status-derived reasons for unknown bodies', async () => {
    expect(await client(vi.fn().mockResolvedValue(json(503, {}))).submitRound('s', SUBMISSION)).toMatchObject({ reason: 'not_configured' });
    expect(await client(vi.fn().mockResolvedValue(json(500, null))).submitRound('s', SUBMISSION)).toMatchObject({ reason: 'service_error' });
  });

  it('reports network failures', async () => {
    const r = await client(vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))).submitRound('session-aaaa1111', SUBMISSION);
    expect(r).toMatchObject({ status: 'unavailable', reason: 'network' });
  });

  it('times out slow servers', async () => {
    const hang = (_u: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
    expect(await client(hang, 20).submitRound('session-aaaa1111', SUBMISSION)).toMatchObject({ reason: 'timeout' });
  });

  it('stops when the caller aborts (stale round) and reports network, not timeout', async () => {
    const hang = (_u: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
    const controller = new AbortController();
    const pending = client(hang, 5000).submitRound('session-aaaa1111', SUBMISSION, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'network' });
  });

  it('refuses a 200 whose round is malformed, undecided, or has an invalid decision', async () => {
    for (const bad of [
      null,
      storedRound({ difficulty: 'nightmare' }),
      storedRound({ decisionStatus: 'failed', decision: null }),
      storedRound({ decisionStatus: 'decided', decision: null }),
      storedRound({ decision: { nextDifficulty: 'impossible', source: 'gemini', performance: 'good', reason: 'x' } }),
      storedRound({ decision: { nextDifficulty: 'hard', source: 'client', performance: 'good', reason: 'x' } }),
      storedRound({ decision: { nextDifficulty: 'hard', source: 'gemini', performance: 'good', reason: '' } }),
      storedRound({ moves: -1 }),
    ]) {
      const r = await client(vi.fn().mockResolvedValue(json(200, { round: bad }))).submitRound('session-aaaa1111', SUBMISSION);
      expect(r).toMatchObject({ status: 'unavailable', reason: 'invalid_response' });
    }
  });

  it('url-encodes the session ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { round: storedRound() }));
    await client(fetchImpl).submitRound('a/b?c', SUBMISSION);
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://api.test/api/sessions/a%2Fb%3Fc/rounds');
  });
});

describe('useFallback, fetchHistory, deleteSession', () => {
  it('requests the labelled rule-based fallback', async () => {
    const fallback = storedRound({ decision: { nextDifficulty: 'medium', source: 'rules_fallback', performance: null, reason: 'The rules move you up.' } });
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { round: fallback }));
    const r = await client(fetchImpl).useFallback('session-aaaa1111', 'round-aaaa1111');
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://api.test/api/sessions/session-aaaa1111/rounds/round-aaaa1111/fallback');
    expect(r).toMatchObject({ status: 'ok', round: { decision: { source: 'rules_fallback', performance: null } } });
  });

  it('returns validated history and silently drops invalid entries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { rounds: [storedRound(), { nonsense: true }, storedRound({ roundNumber: 2, clientRoundId: 'round-bbbb2222' })] }));
    const r = await client(fetchImpl).fetchHistory('session-aaaa1111');
    expect(r.status === 'ok' && r.rounds.map((x) => x.roundNumber)).toEqual([1, 2]);
    expect(fetchImpl.mock.calls[0]![1].method).toBe('GET');
  });

  it('keeps failed rounds in history as undecided', async () => {
    const r = await client(vi.fn().mockResolvedValue(json(200, { rounds: [storedRound({ decisionStatus: 'failed', decision: null, failureCode: 'timeout' })] }))).fetchHistory('session-aaaa1111');
    expect(r.status === 'ok' && r.rounds[0]).toMatchObject({ decisionStatus: 'failed', decision: null });
  });

  it('reports an unknown session', async () => {
    expect(await client(vi.fn().mockResolvedValue(json(404, { error: 'session_not_found' }))).fetchHistory('x')).toMatchObject({ reason: 'session_not_found' });
  });

  it('deletes a session (204 has no body)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });
    expect(await client(fetchImpl).deleteSession('session-aaaa1111')).toEqual({ status: 'ok' });
    expect(fetchImpl.mock.calls[0]![1].method).toBe('DELETE');
  });
});

describe('parseStoredRound', () => {
  it('accepts a well-formed pending round', () => {
    expect(parseStoredRound(storedRound({ decisionStatus: 'pending', decision: null }))).toMatchObject({ decisionStatus: 'pending', decision: null });
  });
  it('requires decided <=> decision present', () => {
    expect(parseStoredRound(storedRound({ decisionStatus: 'pending' }))).toBeNull();
  });
  it('rejects bad dates and non-objects', () => {
    expect(parseStoredRound(storedRound({ createdAt: 'yesterday' }))).toBeNull();
    expect(parseStoredRound('x')).toBeNull();
  });
});
