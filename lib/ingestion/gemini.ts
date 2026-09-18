/**
 * Gemini access for the ingestion pipeline: verification and link selection.
 *
 * One document per call, as before — batching only saved money on a flat-rate
 * provider, and one call per document is still the most accurate.
 */

import { generateJson, geminiExtractionModel } from '../gemini';

/** Ask for a JSON object and return it parsed, or null if the reply was unusable. */
export async function callGemini(
  prompt: string,
  maxTokens: number,
  options: { googleSearch?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  return generateJson(prompt, {
    model: geminiExtractionModel(),
    maxOutputTokens: maxTokens,
    temperature: 0,
    timeoutMs: 90_000,
    googleSearch: options.googleSearch,
  });
}
