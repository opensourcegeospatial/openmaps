import { describe, it, expect } from 'vitest';
import { formatCaptureDate } from './formatDate';

describe('formatCaptureDate', () => {
  it('formats ISO date strings in Norwegian', () => {
    expect(formatCaptureDate('2024-03-05')).toBe('5. mars 2024');
  });

  it('formats epoch milliseconds in Norwegian', () => {
    expect(formatCaptureDate(Date.UTC(2023, 10, 17, 12))).toBe('17. november 2023');
  });

  it('formats a year-month value as month and year only', () => {
    expect(formatCaptureDate('2024-06')).toBe('juni 2024');
  });

  it('returns non-date strings unchanged and null for missing values', () => {
    expect(formatCaptureDate('sommer 2019')).toBe('sommer 2019');
    expect(formatCaptureDate(undefined)).toBeNull();
    expect(formatCaptureDate(null)).toBeNull();
  });
});
