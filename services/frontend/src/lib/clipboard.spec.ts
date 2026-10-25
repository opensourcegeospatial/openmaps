import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from './clipboard';

const define = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { value, configurable: true, writable: true });

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
  Reflect.deleteProperty(window, 'isSecureContext');
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('uses the Clipboard API in a secure context', async () => {
    define(window, 'isSecureContext', true);
    const writeText = vi.fn(async () => {});
    define(navigator, 'clipboard', { writeText });
    expect(await copyText('Avstand: 1,2 km')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Avstand: 1,2 km');
  });

  it('falls back to a selected textarea on plain http and gives focus back', async () => {
    define(window, 'isSecureContext', false);
    const execCommand = vi.fn(() => true);
    define(document, 'execCommand', execCommand);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    expect(await copyText('https://example.no')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('reports failure when neither the API nor the fallback works', async () => {
    define(window, 'isSecureContext', true);
    define(navigator, 'clipboard', {
      writeText: vi.fn(async () => {
        throw new Error('denied');
      })
    });
    define(document, 'execCommand', () => {
      throw new Error('unsupported');
    });
    expect(await copyText('x')).toBe(false);
  });
});
