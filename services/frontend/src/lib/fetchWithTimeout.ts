/**
 * fetch wrapper that adds an abort-on-timeout and merges an optional external
 * AbortSignal.
 *
 * The request is aborted when either:
 *  - the internal timeout (default 15000ms) elapses, or
 *  - the caller-supplied `signal` aborts.
 *
 * On timeout the rejection is a DOMException with name 'TimeoutError';
 * external aborts surface as the usual 'AbortError'. Callers can therefore
 * distinguish "took too long" from "superseded/cancelled".
 */
export interface FetchWithTimeoutOptions extends RequestInit {
  /** Timeout in milliseconds before the request is aborted. Default 15000. */
  timeoutMs?: number;
  /** External signal to merge with the internal timeout controller. */
  signal?: AbortSignal | null;
}

export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = 15000, signal: externalSignal, ...init } = options;

  const controller = new AbortController();

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    // Norwegian on purpose: this message may be shown to the user as-is.
    controller.abort(new DOMException('Forespørselen tok for lang tid', 'TimeoutError'));
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
