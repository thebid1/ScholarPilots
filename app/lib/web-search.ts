/**
 * Web search and page fetching, used by the opportunity finder.
 *
 * These are the hands for the model's tool calls: it decides *what* to look up,
 * this module actually goes and gets it.
 */

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

/**
 * The Brave key. Read under both names: the working local env uses
 * BRAVE_SEARCH_API_KEY, while earlier config used BRAVE_API_KEY, and a
 * mismatch here fails as a 503 that looks like an outage rather than a
 * misnamed variable.
 */
export function braveApiKey(): string | undefined {
  return process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
}

/** Search the web. Returns [] when the key is missing or the call fails. */
export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  const key = braveApiKey();
  if (!key) {
    console.warn('[web-search] BRAVE_SEARCH_API_KEY is not set');
    return [];
  }

  try {
    const response = await fetch(
      `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${count}`,
      {
        headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      console.warn(`[web-search] Brave returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.web?.results ?? []).map((r: { title?: string; url?: string; description?: string }) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      // Brave marks query terms with <strong>; the model does not need the markup.
      description: (r.description ?? '').replace(/<[^>]+>/g, ''),
    }));
  } catch (error) {
    console.warn('[web-search] Search failed:', error);
    return [];
  }
}

/**
 * Fetch a page and reduce it to readable text.
 *
 * Deliberately tolerant: bot walls, JS-only pages and PDFs are expected here, so
 * a failure returns an explanatory string for the model to read rather than
 * throwing. The model can then try a different source.
 */
export async function fetchPageText(url: string, maxChars = 12_000): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        // Some funder sites 403 an obviously non-browser agent.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      return `[Could not open ${url} — HTTP ${response.status}. Try another source.]`;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html') && !contentType.includes('text')) {
      return `[${url} is ${contentType || 'a non-HTML file'} and cannot be read as text. Try another source.]`;
    }

    const html = await response.text();
    const text = html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
      .replace(/&pound;/g, '£')
      .replace(/&euro;/g, '€')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length < 200) {
      return `[${url} returned almost no readable text — it is probably JavaScript-rendered. Try another source.]`;
    }

    return text.slice(0, maxChars);
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
    return `[Fetching ${url} ${reason}. Try another source.]`;
  }
}
