import { describe, it, expect } from 'vitest';
import { toUserMessage } from './errors';

const FALLBACK = 'Noe gikk galt. Prøv igjen.';

describe('toUserMessage', () => {
  it('passes through messages from application errors', () => {
    expect(toUserMessage(new Error('Ingen lag funnet i tjenesten'), FALLBACK)).toBe(
      'Ingen lag funnet i tjenesten'
    );
  });

  it('replaces browser network errors ("Failed to fetch") with the fallback', () => {
    expect(toUserMessage(new TypeError('Failed to fetch'), FALLBACK)).toBe(FALLBACK);
  });

  it('replaces JSON/URI parse errors with the fallback', () => {
    expect(toUserMessage(new SyntaxError('Unexpected token < in JSON'), FALLBACK)).toBe(FALLBACK);
    expect(toUserMessage(new URIError('URI malformed'), FALLBACK)).toBe(FALLBACK);
  });

  it('keeps the timeout message (already Norwegian) but hides plain aborts', () => {
    expect(
      toUserMessage(new DOMException('Forespørselen tok for lang tid', 'TimeoutError'), FALLBACK)
    ).toBe('Forespørselen tok for lang tid');
    expect(toUserMessage(new DOMException('The user aborted', 'AbortError'), FALLBACK)).toBe(
      FALLBACK
    );
  });

  it('uses the fallback for non-Error values and empty messages', () => {
    expect(toUserMessage('boom', FALLBACK)).toBe(FALLBACK);
    expect(toUserMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(toUserMessage(new Error('   '), FALLBACK)).toBe(FALLBACK);
  });
});

