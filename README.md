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

The server listens on `127.0.0.1` only, so it cannot be reached from the internet. To open the
office from your own computer, see [Open it from your PC](#open-it-from-your-pc-ssh-tunnel).

| Setting | Default | Meaning |
|---|---|---|
| `BACKOFFICE_PORT` | `47831` | Port to listen on. The server refuses to start if it is taken. |
| `BACKOFFICE_SOURCE` | `openrig` | `mock` shows a made-up office without OpenRig. |
| `OPENRIG_URL` | `http://127.0.0.1:7433` | Where the OpenRig daemon answers. |
| `OPENRIG_TERMINAL_BEARER_TOKEN` | unset | Only if your daemon was started with tokens. |

Controls: drag to move, scroll to zoom, right-drag to turn, click an agent (or its row in the list)
to open it, `Follow` to keep the camera on it, `Esc` to close.

## How it works, in short

```
 your PC                              the VPS
┌─────────────┐    SSH tunnel    ┌──────────────────────────────────────────────┐
│  browser    │ ───────────────> │ office server ──reads──> OpenRig ──> agents  │
│ localhost:  │    port 47831    │ 127.0.0.1:47831          127.0.0.1:7433      │
│   47831     │ <─────────────── │                                              │
└─────────────┘   live updates   └──────────────────────────────────────────────┘
```

1. **OpenRig runs the agents.** Each agent is a "seat" in a team ("rig"), sitting in its own
   terminal on the VPS. OpenRig knows, for every seat, whether it is working, idle or stopped at a
   question.
2. **The office server asks OpenRig what is going on.** It runs on the VPS next to OpenRig, reads
   the list of seats and their tasks, and turns that into one simple picture of the office: who is
   there, which pod they belong to, what state they are in.
3. **Your browser draws that picture in 3D.** Each seat becomes a character at a desk. When a seat
   changes state, OpenRig tells the server, the server tells the browser, and the character changes
   within about a second.
4. **Clicking an agent** asks the server for that agent's terminal text and its open tasks. The
   message box sends your text to the server, which types it into that agent's prompt.

The browser never talks to OpenRig or to the agents directly. Everything goes through the office
server, and the office server only listens on the VPS itself. That is why you need the tunnel.

### What you see for each agent

| The agent is… | In the office | Meaning |
|---|---|---|
| Working | Typing, monitor lit | It is in the middle of a turn. |
| Idle | Sitting still, monitor dim | It finished and is waiting for work. |
| Needs you | Orange bubble with the reason, top of the list | It stopped at a question or a permission prompt and will not continue until someone answers in its terminal. |
| Unknown | Greyed out | OpenRig cannot tell (for example, the session is gone). |

Agents sit together by pod, each pod with its own shirt colour. The OpenRig `kernel` team (the
operator and its helpers) has its own glass room.

## Open it from your PC (SSH tunnel)

A tunnel makes port 47831 on your PC lead to port 47831 on the VPS, through your normal SSH login.
Nothing is opened to the internet.

### 1. Find your SSH details

You need four values: the server **address**, the SSH **port**, the **user**, and the **key file**
(or a password). If you have connected to this VPS by SSH before, they are on your PC. Run these
on your PC, not on the VPS.

macOS or Linux:

```sh
cat ~/.ssh/config                                  # look for HostName, Port, User, IdentityFile
grep -h "ssh " ~/.zsh_history ~/.bash_history      # earlier ssh commands you typed
ls ~/.ssh                                          # your key files (id_ed25519, id_rsa, ...)
```

Windows (PowerShell):

```powershell
Get-Content $env:USERPROFILE\.ssh\config
Select-String -Path (Get-PSReadLineOption).HistorySavePath -Pattern "ssh "
Get-ChildItem $env:USERPROFILE\.ssh
```

If these show nothing, the values are in your hosting provider's panel, usually as a ready-made
"SSH access" line such as `ssh -p 22022 user@host`.

### 2. Check that plain SSH works

```sh
ssh -p <port> <user>@<address> "echo connected"
```

It should print `connected`. If it does not, fix that first; the tunnel uses the same login.
Add `-i <path-to-key>` if your key is not picked up on its own.

### 3. Open the tunnel

```sh
ssh -N -p <port> -L 47831:127.0.0.1:47831 <user>@<address>
```

The command prints nothing and seems to hang. That is correct: the tunnel is open for as long as it
runs. Leave that window open and browse to <http://localhost:47831>. Press `Ctrl+C` to close it.

### 4. Optional: save it under a short name

Add this to `~/.ssh/config` on your PC (on Windows, `C:\Users\<you>\.ssh\config`):

```
Host backoffice
  HostName <address>
  Port <port>
  User <user>
  IdentityFile ~/.ssh/<key-file>
  LocalForward 47831 127.0.0.1:47831
```

From then on the tunnel is `ssh -N backoffice`.

### If it does not work

| What you see | Likely cause |
|---|---|
| `Connection refused` or a timeout from `ssh` | Wrong address or port, or the provider does not offer SSH for this machine. |
| `Permission denied` | Wrong user or key. |
| `bind: Address already in use` | Something on your PC already uses 47831. Use `-L 47999:127.0.0.1:47831` and open `http://localhost:47999`. |
| The browser says it cannot connect, the tunnel is open | The office server is not running on the VPS. Start it with the commands in "Run it". |
| The page loads and says OpenRig is unreachable | The OpenRig daemon is stopped on the VPS. |

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
