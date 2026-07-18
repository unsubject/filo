/**
 * Real AiClient backed by the Anthropic Messages API via fetch
 * (Workers-compatible). Never logs request/response payloads (spec §6).
 */
import {
  type AiClient,
  type CorrectionInput,
  type CorrectionResult,
  type SealLine,
  type SealMeta,
  CORRECTION_MODEL,
  SEAL_MODEL,
} from './client.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const CORRECTION_SYSTEM = [
  'You silently correct a batch of writing lines.',
  'Fix only medium-to-high-confidence spelling and grammar errors.',
  'Do NOT rephrase, restructure, or change meaning, tone, or style.',
  'Preserve mixed English and Traditional Chinese (Hong Kong register) exactly.',
  'If there is no confident fix for a line, return that line unchanged.',
  'You receive a JSON array of {"id","raw_text"} objects.',
  'Return ONLY a JSON array of {"id","corrected_text"} objects, one per input,',
  'preserving the given ids. Return no commentary, no markdown fences.',
].join(' ');

const SEAL_SYSTEM = [
  'You format captured raw lines into clean, structured Markdown.',
  'Allowed: headings, paragraphs, bullet lists, and blockquotes where clearly',
  'implied by the raw lines.',
  'Not allowed: adding new claims, reordering, summarizing, translating,',
  'changing register or voice, or inventing headings the content does not',
  'support. Ambiguous fragments stay fragments — do not over-polish.',
  'Intentional blank lines are paragraph breaks. Preserve mixed English and',
  'Traditional Chinese exactly. Return Markdown only — no commentary, no fences.',
].join(' ');

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
}

// Normal, complete terminations. Anything else (notably `max_tokens`) means the
// model was cut off mid-generation and the content is truncated — we must never
// store that partial output as a successful correction/seal (spec §5.5/§5.6).
const TERMINAL_STOP_REASONS = new Set(['end_turn', 'stop_sequence']);

export class AnthropicClient implements AiClient {
  constructor(private readonly apiKey: string) {}

  private async call(
    model: string,
    system: string,
    userText: string,
    maxTokens: number,
    opts?: { disableThinking?: boolean },
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
    };
    // On models with adaptive thinking on by default (Sonnet 5), thinking shares
    // the `max_tokens` budget with output. For the seal we need the whole budget
    // for formatted markdown, so disable thinking — otherwise long documents get
    // truncated (stop_reason=max_tokens) and the guard below fails the seal.
    if (opts?.disableThinking) {
      body.thinking = { type: 'disabled' };
    }
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Do not include response body — it may echo private writing.
      throw new Error(`anthropic_http_${res.status}`);
    }
    const data = (await res.json()) as AnthropicResponse;
    // A 200 can still carry truncated content when generation was cut short
    // (e.g. stop_reason "max_tokens"). Reject it so seal fails cleanly (draft
    // untouched + retryable) and correction marks the batch failed + retryable,
    // rather than silently dropping the tail of a long document.
    const stopReason = data.stop_reason ?? null;
    if (stopReason !== null && !TERMINAL_STOP_REASONS.has(stopReason)) {
      // Reason strings are model-controlled but non-sensitive (never the writing).
      throw new Error(`anthropic_truncated_${stopReason}`);
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    return text.trim();
  }

  async correctLines(lines: CorrectionInput[]): Promise<CorrectionResult[]> {
    if (lines.length === 0) return [];
    const payload = JSON.stringify(
      lines.map((l) => ({ id: l.id, raw_text: l.raw_text })),
    );
    let raw: string;
    try {
      raw = await this.call(CORRECTION_MODEL, CORRECTION_SYSTEM, payload, 2048);
    } catch (err) {
      // Whole-batch failure: mark every line failed so callers can retry.
      const message = err instanceof Error ? err.message : 'correction_failed';
      return lines.map((l) => ({
        id: l.id,
        corrected_text: l.raw_text,
        error: message,
      }));
    }

    const parsed = parseJsonArray(raw);
    const byId = new Map<string, string>();
    if (parsed) {
      for (const item of parsed) {
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).id === 'string' &&
          typeof (item as Record<string, unknown>).corrected_text === 'string'
        ) {
          const rec = item as { id: string; corrected_text: string };
          byId.set(rec.id, rec.corrected_text);
        }
      }
    }

    return lines.map((l) => {
      const corrected = byId.get(l.id);
      if (corrected === undefined) {
        return {
          id: l.id,
          corrected_text: l.raw_text,
          error: 'missing_in_model_output',
        };
      }
      return { id: l.id, corrected_text: corrected };
    });
  }

  async formatSeal(lines: SealLine[], meta: SealMeta): Promise<string> {
    const rendered = lines
      .map((l) => (l.is_blank ? '' : l.text))
      .join('\n');
    const userText = `Title: ${meta.title}\n\nRaw lines:\n${rendered}`;
    // Generous budget to reduce truncation on long documents; the stop_reason
    // guard in `call` still rejects any response that is cut off regardless.
    // Disable Sonnet 5's default adaptive thinking so the entire max_tokens
    // budget goes to the formatted markdown (thinking+output share that budget).
    return this.call(SEAL_MODEL, SEAL_SYSTEM, userText, 16384, {
      disableThinking: true,
    });
  }
}

function parseJsonArray(text: string): unknown[] | null {
  // Tolerate accidental code fences.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const value = JSON.parse(cleaned);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
