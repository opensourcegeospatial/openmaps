import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from './fetchWithTimeout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const neverResolving = (_url: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

describe('fetchWithTimeout', () => {
  it('rejects with a TimeoutError carrying a Norwegian message when the timeout elapses', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(neverResolving);

    const pending = fetchWithTimeout('/api/x', { timeoutMs: 1000 });
    const settled = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1001);
    const err = await settled;

    expect(err.name).toBe('TimeoutError');
    expect(err.message).toBe('Forespørselen tok for lang tid');
  });

  it('rejects with an AbortError when the caller aborts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(neverResolving);
    const controller = new AbortController();
    const pending = fetchWithTimeout('/api/x', { signal: controller.signal }).catch((e) => e);
    controller.abort();
    const err = await pending;
    expect(err.name).toBe('AbortError');
  });

  it('clears the timer when the request settles first', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok'));
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await fetchWithTimeout('/api/x', { timeoutMs: 1000 });
    expect(clearSpy).toHaveBeenCalled();
  });
});
