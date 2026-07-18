import { displayText, type CanvasLine } from "../state/useFilo";

export interface LineStackProps {
  lines: CanvasLine[];
}

/**
 * The committed lines, stacked upward. Contrast hierarchy (§7): the newest
 * lines are the most present, older ones fade further into scrollback. There
 * are deliberately NO per-line affordances — no edit, no badges, no diffs, no
 * hover controls (§2 "capture, not editor", §7).
 */
export function LineStack({ lines }: LineStackProps) {
  const total = lines.length;
  return (
    <div className="line-stack" data-testid="line-stack">
      {lines.map((line, i) => {
        // Distance from the newest line drives the fade (0 = newest).
        const fromEnd = total - 1 - i;
        const fade = Math.min(fromEnd, 8);
        const text = displayText(line);
        const isBlank = text.length === 0;
        return (
          <div
            key={line.id}
            className="committed-line"
            data-testid="committed-line"
            data-fade={fade}
            data-blank={isBlank ? "true" : undefined}
            style={{ opacity: Math.max(0.35, 1 - fade * 0.08) }}
          >
            {isBlank ? " " : text}
          </div>
        );
      })}
    </div>
  );
}
