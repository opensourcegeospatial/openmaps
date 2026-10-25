import { describe, it, expect } from 'vitest';
import { PendingLoads } from './pendingLoads';

describe('PendingLoads', () => {
  it('starting a load for a key aborts the previous load for that key', () => {
    const pending = new PendingLoads();
    const first = pending.start('a');
    const second = pending.start('a');
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(pending.has('a')).toBe(true);
  });

  it('isCurrent is true only for the latest controller of a key', () => {
    const pending = new PendingLoads();
    const first = pending.start('a');
    const second = pending.start('a');
    expect(pending.isCurrent('a', first)).toBe(false);
    expect(pending.isCurrent('a', second)).toBe(true);
  });

  it('finish clears the key only when the finishing controller is current', () => {
    const pending = new PendingLoads();
    const stale = pending.start('a');
    const current = pending.start('a');
    pending.finish('a', stale);
    expect(pending.has('a')).toBe(true);
    pending.finish('a', current);
    expect(pending.has('a')).toBe(false);
  });

  it('cancel aborts and forgets one key; cancelAll does so for every key', () => {
    const pending = new PendingLoads();
    const a = pending.start('a');
    const b = pending.start('b');
    pending.cancel('a');
    expect(a.signal.aborted).toBe(true);
    expect(pending.has('a')).toBe(false);
    expect(pending.has('b')).toBe(true);
    pending.cancelAll();
    expect(b.signal.aborted).toBe(true);
    expect(pending.has('b')).toBe(false);
  });

  it('cancelExcept aborts every key not in the keep-set', () => {
    const pending = new PendingLoads();
    const a = pending.start('a');
    const b = pending.start('b');
    pending.cancelExcept(new Set(['b']));
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });
});
