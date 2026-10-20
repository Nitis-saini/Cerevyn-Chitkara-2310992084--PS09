import { GoogleGenAI } from '@google/genai';
import type { ServerConfig } from './config';

export type ModelErrorCode = 'not_configured' | 'timeout' | 'rate_limited' | 'invalid_response' | 'service_error';

export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface LlmPrompt {
  system: string;
  user: string;
  schema: unknown;
}

/** Sends a prompt to the model and returns its raw text. Replaceable in tests. */
export type LlmGenerate = (prompt: LlmPrompt, signal: AbortSignal) => Promise<string>;

/** Maps SDK/network failures to a safe ModelError (never exposes provider details). */
function toModelError(err: unknown, timedOut: boolean): ModelError {
  if (err instanceof ModelError) return err;
  if (timedOut) return new ModelError('timeout', 'The model did not answer in time');
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 429) return new ModelError('rate_limited', 'The model provider rate limit was reached');
  return new ModelError('service_error', 'The model provider request failed');
}

/**
 * Runs one model call with a hard timeout and abort. Shared by all LLM evaluation calls
 * so they all use the same Gemini client and failure mapping. Throws ModelError only.
 */
export async function runModel(
  prompt: LlmPrompt,
  deps: { generate: LlmGenerate; timeoutMs: number },
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ModelError('timeout', 'The model did not answer in time'));
    }, deps.timeoutMs);
  });

  try {
    return await Promise.race([deps.generate(prompt, controller.signal), timeout]);
  } catch (err) {
    throw toModelError(err, timedOut);
  } finally {
    clearTimeout(timer);
  }
}

export function createGeminiGenerate(config: Pick<ServerConfig, 'geminiApiKey' | 'geminiModel'>): LlmGenerate {
  return async (prompt, signal) => {
    if (!config.geminiApiKey) throw new ModelError('not_configured', 'GEMINI_API_KEY is not set');
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt.user,
      config: {
        systemInstruction: prompt.system,
        responseMimeType: 'application/json',
        responseJsonSchema: prompt.schema,
        temperature: 0.4,
        maxOutputTokens: 600,
        abortSignal: signal,
      },
    });
    return response.text ?? '';
  };
}
