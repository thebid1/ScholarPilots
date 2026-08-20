/**
 * Primitives shared across the ingestion stages: coercion, URL canonicalisation,
 * scholarship identity, and config reading.
 *
 * Everything here is pure and dependency-free so the stages can import freely
 * without cycles.
 */

/** Read an integer env var, clamped to a sane range. Bad values fall back. */
export function integerSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(parsed, maximum));
}

/** Read a comma-, semicolon-, or newline-separated env var into a trimmed list. */
export function configuredList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(/\r?\n|,|;/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean);
  const single = asString(value);
  return single ? [single] : [];
}

export function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = asString(value).replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * A deadline is usable only if it is an exact date that has not passed. The
 * catalog query filters on `deadline >= CURRENT_DATE` and the reminder cron does
 * date arithmetic on it, so "rolling" or "March 2027" cannot be stored.
 */
export function isOpenDeadline(value: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return validIsoDate(value) && value >= today;
}

/**
 * Strip the parts of a URL that vary without changing the page: fragments,
 * tracking parameters, trailing slashes, case. Used as the dedupe key for both
 * crawled articles and stored `source_url`s.
 */
export function canonicalUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return sourceUrl.split('#')[0].replace(/\/$/, '').toLowerCase();
  }
}

const COMPOUND_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'org.uk', 'gov.uk', 'sch.uk',
  'edu.au', 'com.au', 'gov.au', 'edu.ng', 'com.ng', 'gov.ng',
  'ac.za', 'co.za', 'gov.za', 'edu.gh', 'gov.gh', 'ac.ke', 'go.ke',
  'edu.in', 'ac.in', 'gov.in', 'ac.jp', 'go.jp', 'edu.cn', 'gov.cn',
  'com.br', 'edu.br', 'gov.br', 'edu.eg', 'gov.eg', 'ac.nz', 'govt.nz',
]);

/**
 * The registrable domain — what "same owner" means here. Handles the compound
 * suffixes that matter for scholarship sources: a naive last-two-labels split
 * would make every `*.ac.uk` university look like the same organisation.
 */
export function ownerDomain(sourceUrl: string): string {
  let hostname: string;
  try {
    hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
  const labels = hostname.split('.');
  if (labels.length < 2) return hostname;
  const suffix = labels.slice(-2).join('.');
  return COMPOUND_SUFFIXES.has(suffix) && labels.length >= 3
    ? labels.slice(-3).join('.')
    : labels.slice(-2).join('.');
}

/**
 * Reduce a title or funder name to comparable tokens, dropping the parts that
 * change between application cycles. "DAAD Scholarship 2027 — Call for
 * Applications" and "DAAD Scholarship (2028 intake)" collapse to the same text,
 * which is what stops an annual award being stored again every year.
 */
export function identityText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(19|20)\d{2}(?:\s*[-/]\s*(?:19|20)?\d{2})?\b/g, ' ')
    .replace(/\b(applications?|apply now|call for applications?|intake|cycle)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Token overlap between two names, 0..1. Deliberately crude; thresholds are conservative. */
export function titleSimilarity(left: string, right: string): number {
  const a = new Set(identityText(left).split(' ').filter(Boolean));
  const b = new Set(identityText(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = Array.from(a).filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

/**
 * Parse a JSON object out of a model reply. `response_format: json_object` is
 * requested but not guaranteed, so fenced blocks and leading prose are both
 * tolerated before giving up.
 */
export function parseJsonObject(content: string): Record<string, unknown> | null {
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const objectOnly = (parsed: unknown) =>
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;

  try {
    return objectOnly(JSON.parse(stripped));
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return objectOnly(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
}

/** Run `worker` over `items` with a fixed number of lanes, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker())
  );
  return results;
}
