import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Active-play stopwatch.
 * - Counts only while `running` is true (stopping keeps the elapsed time).
 * - Changing `resetKey` resets elapsed time to zero.
 * - Exactly one interval exists at a time; it is cleared on every re-run and unmount.
 * - `getElapsedMs()` returns an exact value at any moment, independent of render timing.
 */
export function useGameTimer(running: boolean, resetKey: number, tickMs = 250) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const baseRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);

  const getElapsedMs = useCallback(
    () => baseRef.current + (startedAtRef.current === null ? 0 : Date.now() - startedAtRef.current),
    [],
  );

  // Reset on a new round. Runs after the previous run's cleanup has banked its time.
  useEffect(() => {
    baseRef.current = 0;
    startedAtRef.current = null;
    setElapsedMs(0);
  }, [resetKey]);

  useEffect(() => {
    if (!running) return;
    startedAtRef.current = Date.now();
    const id = setInterval(() => setElapsedMs(getElapsedMs()), tickMs);
    return () => {
      clearInterval(id);
      if (startedAtRef.current !== null) {
        baseRef.current += Date.now() - startedAtRef.current;
        startedAtRef.current = null;
      }
      setElapsedMs(baseRef.current);
    };
  }, [running, resetKey, tickMs, getElapsedMs]);

  return { elapsedMs, getElapsedMs };
}
