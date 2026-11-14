import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskError, type NewTask, type TaskCreated, type TaskStore } from '@backoffice/core';
import { runRig, type RigRunner } from './settings.ts';

export interface RigQueueOptions {
  run?: RigRunner;
  /** The person's gateway address ("name@external"); by default OpenRig's default participant. */
  person?: string;
}

const PERSON = /^[A-Za-z0-9][A-Za-z0-9._-]*@external$/;
const REASON = 'Canceled in OpenRig Space';

/**
 * Tasks kept in OpenRig's queue. A task is created as a queue row from the
 * person to the chosen seat (OpenRig nudges the seat), and the person may
 * cancel one. Claiming, handing off and closing stay with the seats.
 */
export class RigQueueTasks implements TaskStore {
  private run: RigRunner;
  private person: string | null;

  constructor(opts: RigQueueOptions = {}) {
    this.run = opts.run ?? runRig;
    this.person = opts.person?.trim() || null;
    if (this.person && !PERSON.test(this.person)) throw new Error(`BACKOFFICE_PERSON must look like name@external, not "${this.person}".`);
  }

  /** Who the rows come from: the configured person, else the gateway's default participant. */
  private async source(): Promise<string> {
    if (this.person) return this.person;
    const done = await this.run(['gateway', 'participants', '--json']);
    try {
      const data = JSON.parse(done.output) as { participants?: Array<{ id?: string; address?: string; default?: boolean }>; default?: { id?: string } };
      const people = data.participants ?? [];
      const chosen = people.find((p) => p.default) ?? people.find((p) => p.id === data.default?.id);
      if (chosen?.address && PERSON.test(chosen.address)) return (this.person = chosen.address);
    } catch {
      // Falls through to the refusal below.
    }
    throw new TaskError(
      'OpenRig knows no person to send tasks from. Register yourself with "rig gateway participants", or set BACKOFFICE_PERSON=name@external.',
      409,
    );
  }

  async create(task: NewTask): Promise<TaskCreated> {
    const source = await this.source();
    const dir = await mkdtemp(join(tmpdir(), 'backoffice-task-'));
    try {
      const file = join(dir, 'body.md');
      await writeFile(file, task.body);
      const done = await this.run([
        'queue', 'create',
        '--source', source,
        '--destination', task.destination,
        '--summary', task.summary,
        '--body-file', file,
        '--priority', task.priority,
        '--tags', 'from:openrig-space',
        '--json',
      ]);
      if (!done.ok) throw new TaskError(`OpenRig did not create the task: ${done.output}`, 502);
      return { id: qitemIdIn(done.output) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async cancel(id: string, reason: string | null): Promise<void> {
    const source = await this.source();
    const done = await this.run([
      'queue', 'update', id,
      '--state', 'done',
      '--closure-reason', 'canceled',
      '--note', reason?.trim() ? `${REASON}: ${reason.trim()}` : REASON,
      '--source', source,
    ]);
    if (!done.ok) throw new TaskError(`OpenRig did not cancel the task: ${done.output}`, 502);
  }
}

/** The row id in `rig queue create --json` output, wherever this version puts it. */
function qitemIdIn(output: string): string | null {
  try {
    const data = JSON.parse(output) as Record<string, unknown>;
    const pick = (o: unknown): string | null => {
      if (!o || typeof o !== 'object') return null;
      const r = o as Record<string, unknown>;
      return typeof r.qitemId === 'string' ? r.qitemId : typeof r.id === 'string' ? r.id : null;
    };
    return pick(data) ?? pick(data.qitem) ?? pick(data.row) ?? pick(data.item);
  } catch {
    return output.match(/\bq[-_A-Za-z0-9]{6,}\b/)?.[0] ?? null;
  }
}

/** OpenRig's machine-wide folders, from `rig config --json`. */
export async function openrigWorkspace(run: RigRunner = runRig): Promise<Record<string, string> | null> {
  const done = await run(['config', '--json']);
  if (!done.ok) return null;
  try {
    const ws = (JSON.parse(done.output) as { workspace?: Record<string, unknown> }).workspace ?? {};
    return Object.fromEntries(Object.entries(ws).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  } catch {
    return null;
  }
}
