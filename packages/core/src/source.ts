import type { OfficeSnapshot } from './model.ts';

/**
 * Where the office gets its people from. OpenRig is one implementation;
 * anything that can answer these four questions can drive the office.
 */
export interface OfficeSource {
  readonly name: string;
  snapshot(): Promise<OfficeSnapshot>;
  /** Calls `onChange` whenever a new snapshot is worth taking. Returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
  /** The last `lines` lines of what is on the agent's screen. */
  readScreen(session: string, lines: number): Promise<string>;
  /** Types a message into the agent's prompt. */
  sendMessage(session: string, text: string): Promise<void>;
}
