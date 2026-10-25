/**
 * Toasts stack at the top right, below the basemap and layer controls
 * (ToastProvider reads --toast-top, defaulting to 6rem). A surface that opens
 * in that corner (the Systemhelse panel, the armed-tool banner) registers its
 * bottom edge here while it is shown, and the stack starts 8px below the lowest
 * of them, never so low that a toast would leave the window.
 */
const bottoms = new Map<string, number>();

export function setToastClearance(key: string, bottom: number | null): void {
  if (typeof document === 'undefined') return;
  if (bottom === null) bottoms.delete(key);
  else bottoms.set(key, bottom);
  const root = document.documentElement;
  if (bottoms.size === 0) {
    root.style.removeProperty('--toast-top');
    return;
  }
  const top = Math.min(Math.max(...bottoms.values()) + 8, window.innerHeight - 120);
  root.style.setProperty('--toast-top', `${Math.round(top)}px`);
}
