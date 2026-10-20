import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// React Testing Library only advances fake timers during its async helpers when it
// detects a `jest` global. This tiny shim lets it do the same under Vitest, so
// user-event works with vi.useFakeTimers().
Object.assign(globalThis, {
  jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
});

afterEach(() => {
  // Server tests run in the node environment, where there is no DOM.
  if (typeof window !== 'undefined') {
    cleanup();
    window.localStorage.clear();
  }
});
