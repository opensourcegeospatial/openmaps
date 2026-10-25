/**
 * Copy text to the clipboard. Deployments are often served over plain http on
 * an internal network, where the Clipboard API does not exist (it needs a
 * secure context); there a selected, invisible textarea and the legacy copy
 * command still work. Resolves false when neither does, so the caller can say
 * so. Focus returns to wherever it was.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission refused: try the fallback below.
    }
  }
  if (typeof document === 'undefined') return false;

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus({ preventScroll: true });
  }
}
