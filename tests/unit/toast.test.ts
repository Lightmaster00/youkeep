import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToast, MAX_VISIBLE_TOASTS } from '../../app/composables/useToast';

describe('useToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    const t = useToast();
    for (const x of [...t.toasts.value]) t.removeToast(x.id);
    vi.useRealTimers();
  });

  it('shows one toast for the same message repeated within 3 s', () => {
    const t = useToast();
    for (let i = 0; i < 12; i++) t.success('Share link copied.');
    expect(t.toasts.value).toHaveLength(1);
    t.error('Share link copied.');
    expect(t.toasts.value).toHaveLength(2);
  });

  it('shows the message again once the dedupe window is over', () => {
    const t = useToast();
    t.info('Saved.', 10_000);
    vi.advanceTimersByTime(3100);
    t.info('Saved.', 10_000);
    expect(t.toasts.value).toHaveLength(2);
  });

  it('keeps at most 4 toasts, dropping the oldest', () => {
    const t = useToast();
    for (let i = 0; i < 7; i++) t.success(`Message ${i}`);
    expect(t.toasts.value).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(t.toasts.value[0]!.message).toBe('Message 3');
  });

  it('dismisses itself after its duration, a repeat extends it', () => {
    const t = useToast();
    t.success('Done.', 3500);
    vi.advanceTimersByTime(2000);
    t.success('Done.', 3500);
    vi.advanceTimersByTime(2000);
    expect(t.toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1600);
    expect(t.toasts.value).toHaveLength(0);
  });
});
