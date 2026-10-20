import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`Memory Game API listening on http://localhost:${config.port}`);
  console.log(
    config.geminiApiKey
      ? `Gemini configured (model: ${config.geminiModel}).`
      : 'GEMINI_API_KEY is not set: difficulty evaluation will report "not configured". The game still works.',
  );
  console.log(`Round results are stored in ${config.databasePath}`);
});

// Close the HTTP server and the database cleanly (Azure sends SIGTERM on restart).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      (app.locals.closeStore as (() => void) | undefined)?.();
      process.exit(0);
    });
  });
}
