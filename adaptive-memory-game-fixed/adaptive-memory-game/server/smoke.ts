/**
 * Manual check of the REAL Gemini integration. Not part of CI or `npm run test:run`.
 *   GEMINI_API_KEY=... npm run ai:smoke
 * Sends one fixed, made-up finished round to the real model through the same code path as the
 * API and prints the validated next-difficulty decision. Exits non-zero if the call or the
 * validation fails.
 */
import { loadConfig } from './config';
import { evaluateWithGemini, buildLlmEvaluationContext } from './evaluation';
import { ModelError, createGeminiGenerate } from './llm';
import { statsForRound } from '../src/utils/roundStats';

const config = loadConfig();
if (!config.geminiApiKey) {
  console.error('GEMINI_API_KEY is not set. Nothing was sent.');
  process.exit(2);
}

try {
  const ctx = buildLlmEvaluationContext(statsForRound('easy', 12, 8, 41), []);
  const decision = await evaluateWithGemini(ctx, {
    generate: createGeminiGenerate(config),
    timeoutMs: config.llmTimeoutMs,
    configured: true,
  });
  console.log(`Live Gemini call succeeded (model: ${config.geminiModel}). Validated decision:`);
  console.log(JSON.stringify(decision, null, 2));
} catch (err) {
  console.error(`Live Gemini call FAILED: ${err instanceof ModelError ? err.code : 'unknown error'}`);
  process.exit(1);
}
