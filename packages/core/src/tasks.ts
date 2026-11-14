/** Work handed to a seat through its rig's queue, as the person writes it on the task board. */

export type TaskPriority = 'routine' | 'urgent' | 'critical';
export const TASK_PRIORITIES: readonly TaskPriority[] = ['routine', 'urgent', 'critical'];

export interface NewTask {
  /** Session of the seat that owns the work, e.g. "dev-build@duo". */
  destination: string;
  summary: string;
  body: string;
  priority: TaskPriority;
}

export interface TaskCreated {
  /** The queue row's id, when the queue reports it. */
  id: string | null;
}

/** Where tasks are created and cancelled. Moving a task along is the owning seat's job, not the board's. */
export interface TaskStore {
  create(task: NewTask): Promise<TaskCreated>;
  cancel(id: string, reason: string | null): Promise<void>;
}

/** A refusal the person can act on; `status` is the HTTP status it maps to. */
export class TaskError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const MAX_SUMMARY = 200;
export const MAX_BODY = 8000;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

/** Checks a new task from outside and returns a clean copy. Throws `TaskError` on anything odd. */
export function cleanTask(input: unknown): NewTask {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaskError('Send the task as a JSON object.');
  const raw = input as Record<string, unknown>;
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  if (!SESSION.test(destination)) throw new TaskError('Pick the agent the task is for.');
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!summary || summary.length > MAX_SUMMARY || /[\r\n]/.test(summary)) {
    throw new TaskError(`The title must be one line of 1 to ${MAX_SUMMARY} characters.`);
  }
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (body.length > MAX_BODY) throw new TaskError(`The details can be at most ${MAX_BODY} characters.`);
  const priority = raw.priority === undefined ? 'routine' : raw.priority;
  if (!TASK_PRIORITIES.includes(priority as TaskPriority)) throw new TaskError('Priority must be routine, urgent or critical.');
  return { destination, summary, body: body || summary, priority: priority as TaskPriority };
}

/** The rig a session belongs to: "dev-build@duo" gives "duo". */
export function rigOfSession(session: string): string | null {
  const at = session.lastIndexOf('@');
  return at > 0 && at < session.length - 1 ? session.slice(at + 1) : null;
}

const OPEN = /^(pending|in[-_ ]?progress|blocked|held)$/i;
/** True while the task still needs doing, so it can still be cancelled. */
export function isOpenTask(state: string): boolean {
  return OPEN.test(state);
}

export type BoardColumn = 'todo' | 'doing' | 'blocked' | 'done';

/** Which board column a queue state belongs in. */
export function columnOf(state: string): BoardColumn {
  const s = state.toLowerCase().replace(/[_ ]/g, '-');
  if (s === 'pending') return 'todo';
  if (s === 'in-progress') return 'doing';
  if (s === 'blocked' || s === 'held') return 'blocked';
  return 'done';
}
