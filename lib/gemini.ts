/**
 * Shared Gemini client. Every AI call in the app — the discipline filter, chat,
 * the "Search by name" and pasted-listing extractors, and the ingestion
 * verification/resolution steps — goes through this one module.
 *
 * Runs against the Google Cloud / Gemini Enterprise Agent Platform via the
 * `@google/genai` SDK in Vertex AI mode. Auth is a server-side service account
 * (GOOGLE_SERVICE_ACCOUNT_JSON, a single stringified key) whose token the SDK
 * mints and refreshes for us; no private key ever reaches the browser.
 */

import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { parseJsonObject } from './ingestion/util';

/** Model for chat, the discipline filter, and the pasted-listing parser. */
export function geminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
}

/** Model for ingestion verification/extraction and search-by-name. */
export function geminiExtractionModel(): string {
  return process.env.GEMINI_EXTRACTION_MODEL || geminiModel();
}

function envVar(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  return raw.trim().replace(/^["']|["']$/g, '');
}

function serviceAccountJson(): Record<string, unknown> | null {
  const raw = envVar('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.private_key === 'string') {
      // A stringified key may carry escaped newlines inside private_key.
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True when the deployment is configured for the Agent Platform (service account). */
export function geminiConfigured(): boolean {
  return Boolean(serviceAccountJson() && envVar('GOOGLE_CLOUD_PROJECT'));
}

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

export interface GeminiMessage {
  role: 'user' | 'model';
  content: string;
}

export interface GenerateOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Mount the Google Search grounding tool so the reply is verified against the live web. */
  googleSearch?: boolean;
  /** Ask for a JSON response (responseMimeType: application/json). */
  json?: boolean;
}

interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface GeminiGrounding {
  searchQueries: string[];
  sources: GroundingSource[];
}

export interface GeminiResult {
  text: string;
  grounding?: GeminiGrounding;
}

function lazyClient(): GoogleGenAI | null {
  const credentials = serviceAccountJson();
  const project = envVar('GOOGLE_CLOUD_PROJECT');
  if (!credentials || !project) return null;
  return new GoogleGenAI({
    vertexai: true,
    project,
    location: envVar('GOOGLE_CLOUD_LOCATION') || 'global',
    googleAuthOptions: { credentials },
  });
}

let cached: GoogleGenAI | null | undefined;

function client(): GoogleGenAI {
  if (cached === undefined) cached = lazyClient();
  if (!cached) throw new GeminiError('GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CLOUD_PROJECT are not configured.', 503);
  return cached;
}

function extractGrounding(response: GenerateContentResponse): GeminiGrounding | undefined {
  const meta = response.candidates?.[0]?.groundingMetadata as
    | { webSearchQueries?: unknown; groundingChunks?: unknown }
    | undefined;
  if (!meta) return undefined;

  const chunks = Array.isArray(meta.groundingChunks)
    ? (meta.groundingChunks as Array<{ web?: { title?: string; uri?: string } }>)
    : [];
  const sources: GroundingSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (typeof uri === 'string' && uri.length > 0) {
      sources.push({ title: chunk.web?.title, uri });
    }
  }

  const searchQueries = Array.isArray(meta.webSearchQueries)
    ? (meta.webSearchQueries as string[]).filter((q) => typeof q === 'string')
    : [];

  if (sources.length === 0 && searchQueries.length === 0) return undefined;
  return { searchQueries, sources };
}

function partsToString(parts: unknown): string {
  const list = parts as Array<{ text?: string }> | undefined;
  return (Array.isArray(list) ? list : [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}


/**
 * One `generateContent` call.
 */
export async function generateContent(
  contents: GeminiMessage[],
  options: GenerateOptions = {}
): Promise<GeminiResult> {
  const model = options.model ?? geminiModel();

  const config: Record<string, unknown> = {
    temperature: options.temperature ?? 0,
    maxOutputTokens: options.maxOutputTokens ?? 2000,
  };
  if (options.json) {
    config.responseMimeType = 'application/json';
  }
  if (options.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }
  if (options.googleSearch) {
    config.tools = [{ googleSearch: {} }];
  }
  if (options.timeoutMs) {
    config.httpOptions = { timeout: options.timeoutMs };
  }

  const response = await client().models.generateContent({
    model,
    contents: contents.map((message) => ({
      role: message.role,
      parts: [{ text: message.content }],
    })),
    config,
  } as never);

  const text = partsToString(response.candidates?.[0]?.content?.parts);
  if (!text) throw new GeminiError('Gemini returned no content.', 502);

  return { text, grounding: extractGrounding(response) };
}

/** One user prompt, reply text only. */
export async function generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
  return (await generateContent([{ role: 'user', content: prompt }], options)).text;
}

/** One user prompt, reply parsed as a JSON object (or null when unparseable). */
export async function generateJson(
  prompt: string,
  options: GenerateOptions = {}
): Promise<Record<string, unknown> | null> {
  const { text } = await generateContent([{ role: 'user', content: prompt }], { ...options, json: true });
  return parseJsonObject(text);
}
