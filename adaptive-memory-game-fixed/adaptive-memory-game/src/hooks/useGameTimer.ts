import { useCallback, useEffect, useRef, useState } from 'react';


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
