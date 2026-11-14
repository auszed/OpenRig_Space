# Backoffice Agents

A 3D office for your AI agents. Every agent running under [OpenRig](https://www.openrig.dev) is a
character at a desk, and you can see at a glance who is working, who is idle and who is waiting for
you. Click an agent to read its screen, see its tasks and type it a message.

Built with Svelte 5, Threlte (three.js) and Bun. Licensed under Apache-2.0.

## Run it

Bun is installed inside the project (`node_modules/.bin/bun`), so nothing global is needed. If you
have Bun on your PATH you can drop the `./node_modules/.bin/` prefix.

```sh
cd ~/backoffice-agents
./node_modules/.bin/bun install        # first time only
./node_modules/.bin/bun run build      # builds the frontend into apps/office/dist
./node_modules/.bin/bun run start      # serves http://127.0.0.1:47831
```

The server listens on `127.0.0.1` only. To open the office from another computer, forward the port
over SSH from that computer and keep the command running:

```sh
ssh -N -L 47831:127.0.0.1:47831 <user>@<server>     # add -p <port> if SSH is not on 22
```

Then open <http://localhost:47831>.

| Setting | Default | Meaning |
|---|---|---|
| `BACKOFFICE_PORT` | `47831` | Port to listen on. The server refuses to start if it is taken. |
| `BACKOFFICE_SOURCE` | `openrig` | `mock` shows a made-up office without OpenRig. |
| `OPENRIG_URL` | `http://127.0.0.1:7433` | Where the OpenRig daemon answers. |
| `OPENRIG_TERMINAL_BEARER_TOKEN` | unset | Only if your daemon was started with tokens. |

Controls: drag to move, scroll to zoom, right-drag to turn, click an agent (or its row in the list)
to open it, `Follow` to keep the camera on it, `Esc` to close.

## What it can do today

- Live office: one character per OpenRig seat, grouped by pod, updated within a second or so of a change.
- Status you can read from across the room: typing (working), still (idle), an orange bubble with
  the reason (waiting for you), greyed out (unknown).
- Agent panel: work counts, context used, open tasks, the live screen, and a message box.
- Two looks, switchable from the top bar: **Studio** and **Night shift**.
- The standup room, PR review room, QA lab, gym and janitor closet are in the building but not wired
  to anything yet. Layout editing, music, GitHub and Jira are also not built yet.

The message box types straight into the agent's prompt, exactly like `rig send`. Nothing else in
this version changes anything: there are no buttons that answer permission prompts or stop,
reset or relaunch agents.

## How it is put together

```
packages/core             the office as data: agents, layout, theme contract, behaviour. No 3D, no OpenRig.
packages/openrig-source   the only code that knows OpenRig (reads its local HTTP API and event streams)
packages/server           Bun server: snapshot, WebSocket feed, screen and message routes, static files
packages/theme-studio     the bright office look
packages/theme-night      the dark look
apps/office               Svelte + Threlte frontend
```

The browser never talks to OpenRig. The server reads OpenRig over localhost, turns it into a plain
`OfficeSnapshot`, and pushes it to the browser over a WebSocket. OpenRig's change streams are
treated as "something changed, read again", with a 5-second poll as a fallback.

### Change the look

A theme is one object with no 3D code in it (see `packages/core/src/theme.ts`): colours for the
panels, a PBR material for each surface slot (`floor`, `glass`, `wood`, `accent`, ...), pod shirt
colours, status colours, lighting and post-processing strength.

1. Copy `packages/theme-studio` to `packages/theme-yours` and edit the values.
2. Add it to the list in `apps/office/src/themes.ts`.

To redraw a piece of furniture rather than recolour it, give the theme a `furniture` entry: a
function that receives the shape kit and returns a three.js object. The built-in ones are in
`apps/office/src/scene/build/furniture.ts`.

### Change the floor plan

`defaultLayout()` in `packages/core/src/layout.ts` is the whole building as data: rooms, walls,
desk benches and furniture positions. Agents are seated by `assignSeats()`: pods stay together and
nobody moves when a status changes.

### Use something other than OpenRig

Implement the four methods of `OfficeSource` (`packages/core/src/source.ts`) and pass it to
`startServer()`. `MockSource` is a small example.

## Develop

```sh
./node_modules/.bin/bun test             # core, OpenRig adapter and server
./node_modules/.bin/bun run check        # type-check the frontend
./node_modules/.bin/bun run dev:server   # server with reload
./node_modules/.bin/bun run dev:web      # Vite on http://127.0.0.1:47832, proxying to the server
```
