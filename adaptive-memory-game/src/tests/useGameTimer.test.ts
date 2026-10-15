import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameTimer } from '../hooks/useGameTimer';

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useGameTimer', () => {
  const setup = () =>
    renderHook(({ running, key }) => useGameTimer(running, key), {
      initialProps: { running: false, key: 0 },
    });

  it('does not count while not running', () => {
    const { result } = setup();
    advance(5000);
    expect(result.current.elapsedMs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts while running and keeps its value after stopping', () => {
    const { result, rerender } = setup();
    rerender({ running: true, key: 0 });
    advance(3000);
    expect(result.current.elapsedMs).toBe(3000);

    rerender({ running: false, key: 0 });
    expect(result.current.elapsedMs).toBe(3000);
    advance(10_000);
    expect(result.current.elapsedMs).toBe(3000);
    expect(result.current.getElapsedMs()).toBe(3000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never creates duplicate intervals across re-renders', () => {
    const { rerender } = setup();
    rerender({ running: true, key: 0 });
    for (let i = 0; i < 10; i++) rerender({ running: true, key: 0 });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('resets to zero when the reset key changes and clears the interval', () => {
    const { result, rerender } = setup();
    rerender({ running: true, key: 0 });
    advance(2000);
    rerender({ running: false, key: 1 });
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.getElapsedMs()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its interval on unmount', () => {
    const { rerender, unmount } = setup();
    rerender({ running: true, key: 0 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
