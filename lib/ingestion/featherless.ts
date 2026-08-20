/**
 * Featherless client for the ingestion pipeline.
 *
 * Same provider and model as the rest of the app's AI work (see
 * app/api/opportunities/parse/route.ts). Featherless is flat-rate, so unlike
 * Firecrawl there is no reason to batch calls to save money — and one document
 * per call is more accurate than five crammed into a single prompt.
 */

import { asString, parseJsonObject } from './util';

const FEATHERLESS_API_URL = 'https://api.featherless.ai/v1/chat/completions';
const FEATHERLESS_MODEL = 'Qwen/Qwen2.5-72B-Instruct';
const REQUEST_TIMEOUT_MS = 90_000;

/** Ask for a JSON object and return it parsed, or null if the reply was unusable. */
export async function callFeatherless(
  prompt: string,
  maxTokens: number
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.FEATHERLESS_API_KEY;
  if (!apiKey) throw new Error('FEATHERLESS_API_KEY is not configured.');

  const response = await fetch(FEATHERLESS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.FEATHERLESS_EXTRACTION_MODEL || FEATHERLESS_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Featherless ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const data = await response.json();
  const content = asString(data.choices?.[0]?.message?.content);
  return content ? parseJsonObject(content) : null;
}
