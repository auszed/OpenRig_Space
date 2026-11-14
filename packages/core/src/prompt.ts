/** One choice in a numbered question an agent is stopped at ("1. Yes", "2. No", ...). */
export interface PromptOption {
  /** The digit that picks it. */
  key: string;
  label: string;
  /** The choice the cursor is on. */
  selected: boolean;
}

const OPTION = /^\s*(?:([❯›>])\s*)?(\d)\.\s+(\S.*)$/;
const unbox = (line: string) => line.replace(/^\s*[│|]\s?/, '').replace(/\s*[│|]\s*$/, '');

/**
 * Finds the numbered question at the bottom of an agent's screen, if there is one.
 *
 * Deliberately strict, because the result becomes buttons that press keys in a real terminal:
 * the choices must be numbered 1, 2, 3… without gaps, there must be at least two, and exactly
 * one must carry the cursor mark. An ordinary numbered list in the agent's output has no cursor
 * mark and is ignored.
 */
export function parsePromptOptions(screen: string, tail = 30): PromptOption[] {
  const lines = screen.split('\n').slice(-tail).map(unbox);
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (OPTION.exec(lines[i]!)?.[2] === '1') {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const options: PromptOption[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const match = OPTION.exec(line);
    if (match) {
      if (Number(match[2]) !== options.length + 1) break;
      options.push({ key: match[2]!, label: match[3]!.trim(), selected: Boolean(match[1]) });
    } else if (!/[\p{L}\p{N}]/u.test(line)) {
      // A blank line or a drawn border ends the question.
      break;
    } else {
      // A long choice wrapped onto the next line.
      options[options.length - 1]!.label += ` ${line.trim()}`;
    }
  }
  const marked = options.filter((o) => o.selected).length;
  return options.length >= 2 && marked === 1 ? options : [];
}
