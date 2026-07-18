/**
 * Deterministic FAKE AiClient for tests — no network.
 *
 * Correction: applies a fixed dictionary of high-confidence typo fixes. Lines
 * with no known typo are returned unchanged (so the route marks them
 * 'unchanged'), exercising the corrected/unchanged split from spec §5.4.
 *
 * Seal: joins lines into markdown, blank lines becoming paragraph breaks. It
 * never summarizes, translates, or invents content — mirroring the §4.6
 * boundaries so tests can assert language mix and ordering are preserved.
 */
import type {
  AiClient,
  CorrectionInput,
  CorrectionResult,
  SealLine,
  SealMeta,
} from './client.js';

const DEFAULT_FIXES: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  wnat: 'want',
  adn: 'and',
  hte: 'the',
};

export interface FakeAiOptions {
  /** Override the typo dictionary. */
  fixes?: Record<string, string>;
  /** Force correctLines to throw (to test whole-batch failure paths). */
  failCorrection?: boolean;
  /** Force formatSeal to throw (to test seal failure paths). */
  failSeal?: boolean;
}

export class FakeAiClient implements AiClient {
  private readonly fixes: Record<string, string>;
  constructor(private readonly opts: FakeAiOptions = {}) {
    this.fixes = opts.fixes ?? DEFAULT_FIXES;
  }

  async correctLines(lines: CorrectionInput[]): Promise<CorrectionResult[]> {
    if (this.opts.failCorrection) {
      throw new Error('fake_correction_failure');
    }
    return lines.map((l) => ({
      id: l.id,
      corrected_text: this.applyFixes(l.raw_text),
    }));
  }

  async formatSeal(lines: SealLine[], meta: SealMeta): Promise<string> {
    if (this.opts.failSeal) {
      throw new Error('fake_seal_failure');
    }
    // Deterministic, boundary-respecting formatting: title as H1, blank lines
    // as paragraph breaks, every other line preserved verbatim.
    const body: string[] = [];
    for (const line of lines) {
      body.push(line.is_blank ? '' : line.text);
    }
    // Collapse leading/trailing blank runs but keep interior breaks.
    const joined = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return `# ${meta.title}\n\n${joined}\n`;
  }

  private applyFixes(text: string): string {
    return text.replace(/[A-Za-z]+/g, (word) => {
      const lower = word.toLowerCase();
      const fix = this.fixes[lower];
      if (!fix) return word;
      // Preserve simple capitalization.
      if (word[0] === word[0]?.toUpperCase()) {
        return fix.charAt(0).toUpperCase() + fix.slice(1);
      }
      return fix;
    });
  }
}
