/**
 * Error-to-text helpers so that only Norwegian, user-facing text ever reaches
 * the UI. Browser-native errors (a failed fetch, a JSON parse error, an abort)
 * carry English messages and are replaced by the caller's fallback; errors
 * thrown by our own code carry Norwegian messages and pass through.
 */

/**
 * Why a request to one of our services failed, in the product's pattern: what
 * failed first, then the cause. The upstream's own message never reaches the
 * user — it names internal services and carries status codes ("Søketjenesten
 * svarte med feil (502)").
 */
export function serviceFailureMessage(failure: string, service: string, status?: number): string {
  const name = service.charAt(0).toUpperCase() + service.slice(1);
  if (status === 502 || status === 503 || status === 504) return `${failure}. ${name} svarer ikke.`;
  if (status !== undefined) return `${failure}. ${name} svarte med en feil.`;
  return `${failure}. Får ikke kontakt med ${service}.`;
}

/** Map any thrown value to a message that is safe to show to the user. */
export function toUserMessage(err: unknown, fallback: string): string {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    // fetchWithTimeout raises a Norwegian TimeoutError; other DOMExceptions
    // (AbortError, NetworkError, …) are not user-facing.
    return err.name === 'TimeoutError' && err.message.trim() ? err.message : fallback;
  }
  if (
    err instanceof TypeError ||
    err instanceof SyntaxError ||
    err instanceof URIError ||
    err instanceof RangeError
  ) {
    return fallback;
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

