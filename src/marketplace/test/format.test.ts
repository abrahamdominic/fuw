import { describe, it, expect } from 'vitest';
import { formatNaira, formatOrderStatus, formatCondition, formatDate, formatTimeAgo } from '../lib/format';

describe('Marketplace Formatting & Helpers', () => {
  it('formats Naira currency correctly from kobo', () => {
    expect(formatNaira(100000)).toBe('₦1,000');
    expect(formatNaira(0)).toBe('₦0');
    expect(formatNaira(2500050)).toBe('₦25,000.50');
    expect(formatNaira(50000000)).toBe('₦500,000');
  });

  it('formats order statuses into human-readable labels and semantic tone', () => {
    const paid = formatOrderStatus('paid');
    expect(paid.label).toBe('Paid · Payment Protected');
    expect(paid.tone).toBe('info');

    const completed = formatOrderStatus('completed');
    expect(completed.label).toBe('Completed');
    expect(completed.tone).toBe('success');

    const disputed = formatOrderStatus('disputed');
    expect(disputed.label).toBe('In Dispute');
    expect(disputed.tone).toBe('danger');

    const cancelled = formatOrderStatus('cancelled');
    expect(cancelled.label).toBe('Cancelled');
    expect(cancelled.tone).toBe('danger');
  });

  it('formats item conditions correctly', () => {
    expect(formatCondition('new')).toBe('Brand New');
    expect(formatCondition('like_new')).toBe('Like New');
    expect(formatCondition('fair')).toBe('Fair / Used');
    expect(formatCondition('not_applicable')).toBe('Service');
  });

  it('formats dates and relative timestamps', () => {
    const iso = '2026-10-04T12:00:00Z';
    expect(formatDate(iso)).toBeTruthy();

    const now = new Date().toISOString();
    expect(formatTimeAgo(now)).toBe('just now');
  });
});
