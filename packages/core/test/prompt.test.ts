import { describe, expect, test } from 'bun:test';
import { parsePromptOptions } from '../src/prompt.ts';

const PERMISSION = `
 Bash command
 git -C /home/node/work log --oneline -15
 This command requires approval

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for: git *
   3. Yes, and switch to auto mode · auto mode handles
these prompts for you
   4. No

 Esc to cancel · Tab to amend
`;

describe('parsePromptOptions', () => {
  test('reads a permission prompt, joining a wrapped choice', () => {
    expect(parsePromptOptions(PERMISSION)).toEqual([
      { key: '1', label: 'Yes', selected: true },
      { key: '2', label: "Yes, and don't ask again for: git *", selected: false },
      { key: '3', label: 'Yes, and switch to auto mode · auto mode handles these prompts for you', selected: false },
      { key: '4', label: 'No', selected: false },
    ]);
  });

  test('reads choices drawn inside a box', () => {
    const boxed = '│ Do you trust this folder?   │\n│ ❯ 1. Yes, proceed           │\n│   2. No, exit               │\n╰─────────────────────────────╯';
    expect(parsePromptOptions(boxed).map((o) => o.label)).toEqual(['Yes, proceed', 'No, exit']);
  });

  test('ignores an ordinary numbered list, which has no cursor mark', () => {
    expect(parsePromptOptions('Plan:\n1. Read the file\n2. Fix the bug\n3. Run the tests\n')).toEqual([]);
  });

  test('ignores a screen with no question, a single choice, or a gap in the numbers', () => {
    expect(parsePromptOptions('> compiling...\n> 12 tests passed')).toEqual([]);
    expect(parsePromptOptions('❯ 1. Yes')).toEqual([]);
    expect(parsePromptOptions('❯ 1. Yes\n  3. No').length).toBe(0);
  });

  test('only looks at the bottom of the screen', () => {
    const old = `❯ 1. Yes\n  2. No\n${'output\n'.repeat(40)}`;
    expect(parsePromptOptions(old)).toEqual([]);
  });
});
