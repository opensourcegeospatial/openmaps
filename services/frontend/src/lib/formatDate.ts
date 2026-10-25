/**
 * Norwegian date formatting for values that arrive as ISO strings, epoch
 * milliseconds or free text (e.g. panorama capture dates). Only ISO-shaped
 * strings (YYYY-MM-DD… or YYYY-MM) are treated as dates: `new Date()` is far
 * too lenient ("sommer 2019" would silently become 1 January 2019). Other
 * text is returned unchanged; missing values yield null.
 */
const NB_LONG_DATE = new Intl.DateTimeFormat('nb-NO', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC'
});

const NB_MONTH_YEAR = new Intl.DateTimeFormat('nb-NO', {
  year: 'numeric',
  month: 'long',
  timeZone: 'UTC'
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

export function formatCaptureDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : NB_LONG_DATE.format(date);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (ISO_MONTH.test(trimmed)) {
      const date = new Date(`${trimmed}-01T00:00:00Z`);
      return Number.isNaN(date.getTime()) ? value : NB_MONTH_YEAR.format(date);
    }
    if (ISO_DATE.test(trimmed)) {
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? value : NB_LONG_DATE.format(date);
    }
    return value;
  }

  return null;
}
