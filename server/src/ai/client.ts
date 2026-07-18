/**
 * AI client interface (spec §5.4 correction, §4.6 / §5.5 seal). Dependency-
 * injected so tests never hit the network.
 */

/** Model + prompt-version constants (spec §3, §5.4, §4.6). */
export const CORRECTION_MODEL = 'claude-haiku-4-5-20251001';
export const CORRECTION_PROMPT_VERSION = 'correct-v1';
export const SEAL_MODEL = 'claude-haiku-4-5-20251001';
export const SEAL_PROMPT_VERSION = 'seal-v1';

export interface CorrectionInput {
  /** Stable line id — corrections target IDs, never seq (spec §5.4). */
  id: string;
  raw_text: string;
}

export interface CorrectionResult {
  id: string;
  /** The corrected text. Equal to raw_text when there is no confident fix. */
  corrected_text: string;
  /** Set when the correction could not be produced for this line. */
  error?: string;
}

export interface SealLine {
  seq: number;
  /** Rendered text (corrected where present, else raw). Empty = blank line. */
  text: string;
  is_blank: boolean;
}

export interface SealMeta {
  title: string;
}

export interface AiClient {
  /**
   * Correct medium-to-high-confidence spelling/grammar only. Must return one
   * result per input line, preserving mixed English + Traditional Chinese, and
   * returning the line unchanged when there is no confident fix.
   */
  correctLines(lines: CorrectionInput[]): Promise<CorrectionResult[]>;

  /**
   * Format raw lines into clean structured markdown within the boundaries of
   * spec §4.6. Returns markdown only.
   */
  formatSeal(lines: SealLine[], meta: SealMeta): Promise<string>;
}
