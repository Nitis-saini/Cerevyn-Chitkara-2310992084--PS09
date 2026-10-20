import { randomUUID } from 'node:crypto';
import type { RoundStats, StoredRound } from '../src/types/game';
import { classifyRound, fallbackDecision } from '../src/utils/performancePolicy';
import { ModelError, type ModelErrorCode, type LlmGenerate } from './llm';
import { StoreError, type RoundStore } from './db';
import { buildLlmEvaluationContext, evaluateWithGemini } from './evaluation';
import { ValidationError, isValidId, parseRoundSubmission } from './validate';

export interface ApiResult {
  status: number;
  /** undefined means an empty body (204). */
  body?: unknown;
}

export interface RoundsDeps {
  store: RoundStore;
  generate: LlmGenerate;
  timeoutMs: number;
  /** False when no API key exists and no test double was injected. */
  configured: boolean;
  /** Model name recorded with each Gemini decision. */
  model: string;
  newSessionId?: () => string;
}

const STATUS_FOR: Record<ModelErrorCode, number> = {
  not_configured: 503,
  timeout: 504,
  rate_limited: 429,
  invalid_response: 502,
  service_error: 502,
};

/** Public, generic messages. Provider errors and keys are never sent to the browser. */
const MESSAGE_FOR: Record<ModelErrorCode, string> = {
  not_configured: 'Gemini is not configured on this server, so the next difficulty could not be evaluated.',
  timeout: 'Gemini did not answer in time.',
  rate_limited: 'Gemini is rate limited. Try again shortly.',
  invalid_response: 'Gemini returned a decision that failed validation.',
  service_error: 'Gemini is temporarily unavailable.',
};

const error = (status: number, code: string, message: string): ApiResult => ({
  status,
  body: { error: code, message },
});

const sameStats = (a: RoundStats, b: RoundStats) =>
  a.difficulty === b.difficulty &&
  a.gridColumns === b.gridColumns &&
  a.gridRows === b.gridRows &&
  a.pairCount === b.pairCount &&
  a.completedPairs === b.completedPairs &&
  a.moves === b.moves &&
  a.mismatches === b.mismatches &&
  a.elapsedSeconds === b.elapsedSeconds;

export class RoundsService {
  /** Requests being processed right now, so a double submit shares one Gemini call. */
  private readonly inFlight = new Map<string, Promise<ApiResult>>();

  constructor(private readonly deps: RoundsDeps) {}

  createSession(): ApiResult {
    const sessionId = (this.deps.newSessionId ?? randomUUID)();
    this.deps.store.createSession(sessionId);
    return { status: 201, body: { sessionId } };
  }

  getHistory(sessionId: string): ApiResult {
    if (!isValidId(sessionId)) return error(400, 'invalid_request', 'Invalid session ID');
    if (!this.deps.store.sessionExists(sessionId)) return error(404, 'session_not_found', 'Unknown session');
    return { status: 200, body: { sessionId, rounds: this.deps.store.listRounds(sessionId) } };
  }

  deleteSession(sessionId: string): ApiResult {
    if (!isValidId(sessionId)) return error(400, 'invalid_request', 'Invalid session ID');
    return this.deps.store.deleteSession(sessionId)
      ? { status: 204 }
      : error(404, 'session_not_found', 'Unknown session');
  }

  /**
   * Evaluates a finished round with Gemini, persists it and returns the validated decision.
   * The decision is returned only after it has been validated AND stored. A resubmission of the
   * same clientRoundId never creates a second round: a decided round is replayed, a failed one is
   * retried, and different statistics under the same ID are rejected.
   */
  submitRound(sessionId: string, body: unknown): Promise<ApiResult> {
    if (!isValidId(sessionId)) return Promise.resolve(error(400, 'invalid_request', 'Invalid session ID'));
    let submission;
    try {
      submission = parseRoundSubmission(body);
    } catch (err) {
      const message = err instanceof ValidationError ? err.message : 'Invalid request';
      return Promise.resolve(error(400, 'invalid_request', message));
    }
    if (!this.deps.store.sessionExists(sessionId)) {
      return Promise.resolve(error(404, 'session_not_found', 'Unknown session'));
    }

    const key = `${sessionId}:${submission.clientRoundId}`;
    const running = this.inFlight.get(key);
    if (running) return running;

    const work = this.process(sessionId, submission).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  private async process(
    sessionId: string,
    submission: ReturnType<typeof parseRoundSubmission>,
  ): Promise<ApiResult> {
    const { store } = this.deps;
    const { clientRoundId, completed: _completed, ...stats } = submission;
    void _completed;

    let round: StoredRound;
    const existing = store.getRound(sessionId, clientRoundId);
    if (existing) {
      if (!sameStats(existing, stats)) {
        return error(409, 'round_conflict', 'This round ID was already used with different statistics.');
      }
      if (existing.decisionStatus === 'decided') return { status: 200, body: { round: existing, replayed: true } };
      round = existing; // pending/failed: evaluate again, do not insert a second row
    } else {
      try {
        round = store.insertRound(sessionId, { ...stats, clientRoundId, policyBand: classifyRound(stats) });
      } catch (err) {
        if (err instanceof StoreError) return error(429, 'rate_limited', 'This session has too many rounds.');
        return this.persistenceError();
      }
    }

    // Earlier rounds only: the trend the model may use. Read from the database, not the client.
    const earlier = store.listRounds(sessionId).filter((r) => r.roundNumber < round.roundNumber);
    const ctx = buildLlmEvaluationContext(stats, earlier);

    let decision;
    try {
      decision = await evaluateWithGemini(ctx, {
        generate: this.deps.generate,
        timeoutMs: this.deps.timeoutMs,
        configured: this.deps.configured,
      });
    } catch (err) {
      const code: ModelErrorCode = err instanceof ModelError ? err.code : 'service_error';
      // Log the category only: never request bodies, keys or provider payloads.
      console.warn(`[evaluate] failed: ${code}`);
      try {
        store.markFailed(sessionId, clientRoundId, code);
      } catch {
        return this.persistenceError();
      }
      return error(STATUS_FOR[code], code, MESSAGE_FOR[code]);
    }

    try {
      const saved = store.recordDecision(sessionId, clientRoundId, {
        nextDifficulty: decision.nextDifficulty,
        source: 'gemini',
        performance: null,
        reason: decision.reason,
        model: this.deps.model,
      });
      if (!saved || saved.decisionStatus !== 'decided') return this.persistenceError();
      return { status: 200, body: { round: saved, replayed: false } };
    } catch {
      return this.persistenceError();
    }
  }

  /**
   * Documented, non-AI fallback chosen by the player after Gemini failed. It is stored with
   * source "rules_fallback" so it can never be mistaken for a Gemini decision, and it never
   * replaces a decision Gemini already made.
   */
  useFallback(sessionId: string, clientRoundId: string): ApiResult {
    if (!isValidId(sessionId) || !isValidId(clientRoundId)) {
      return error(400, 'invalid_request', 'Invalid ID');
    }
    const { store } = this.deps;
    if (!store.sessionExists(sessionId)) return error(404, 'session_not_found', 'Unknown session');
    if (this.inFlight.has(`${sessionId}:${clientRoundId}`)) {
      return error(409, 'round_conflict', 'This round is still being evaluated.');
    }
    const round = store.getRound(sessionId, clientRoundId);
    if (!round) return error(404, 'round_not_found', 'Unknown round');
    if (round.decisionStatus === 'decided') return { status: 200, body: { round, replayed: true } };

    const { nextDifficulty, reason } = fallbackDecision(round);
    try {
      const saved = store.recordDecision(sessionId, clientRoundId, {
        nextDifficulty,
        source: 'rules_fallback',
        performance: null,
        reason,
        model: null,
      });
      if (!saved || saved.decisionStatus !== 'decided') return this.persistenceError();
      return { status: 200, body: { round: saved, replayed: false } };
    } catch {
      return this.persistenceError();
    }
  }

  private persistenceError(): ApiResult {
    console.warn('[evaluate] failed: persistence_error');
    return error(500, 'persistence_error', 'The round result could not be saved.');
  }
}
