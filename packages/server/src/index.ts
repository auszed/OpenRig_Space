import { resolve } from 'node:path';
import { MemorySettings, MockSource, type OfficeSource } from '@backoffice/core';
import { OpenRigSource } from '@backoffice/openrig-source';
import { startServer } from './server.ts';
import { TeamFileSettings } from './settings.ts';

const port = Number(process.env.BACKOFFICE_PORT ?? 47831);
const kind = process.env.BACKOFFICE_SOURCE ?? 'openrig';
const openrigUrl = process.env.OPENRIG_URL ?? `http://127.0.0.1:${process.env.OPENRIG_PORT ?? 7433}`;

const source: OfficeSource =
  kind === 'mock'
    ? new MockSource()
    : new OpenRigSource({ baseUrl: openrigUrl, token: process.env.OPENRIG_TERMINAL_BEARER_TOKEN });

try {
  const server = startServer({
    source,
    settings: kind === 'mock' ? new MemorySettings() : new TeamFileSettings({ teamsDir: process.env.BACKOFFICE_TEAMS_DIR }),
    port,
    staticDir: resolve(import.meta.dir, '../../../apps/office/dist'),
  });
  console.log(`Backoffice Agents: ${server.url}  (source: ${source.name}${kind === 'mock' ? '' : ` at ${openrigUrl}`})`);
  console.log(`From another computer: ssh -N -L ${server.port}:127.0.0.1:${server.port} <user>@<this-host>, then open http://localhost:${server.port}`);
} catch (err) {
  const code = (err as { code?: string }).code;
  console.error(
    code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop whatever holds it, or pick another with BACKOFFICE_PORT.`
      : `Could not start: ${(err as Error).message}`,
  );
  process.exit(1);
}
