# OpenRig Space

Repository: <https://github.com/auszed/OpenRig_Space>

A 3D office for your AI agents. Every agent running under [OpenRig](https://www.openrig.dev) is a
character at a desk, and you can see at a glance who is working, who is idle and who is waiting for
you. Click an agent to read its screen, see its tasks and type it a message.

Built with Svelte 5, Threlte (three.js) and Bun. Licensed under Apache-2.0.

## Run it

Bun is installed inside the project (`node_modules/.bin/bun`), so nothing global is needed. If you
have Bun on your PATH you can drop the `./node_modules/.bin/` prefix.

```sh
cd ~/openrig/space
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
| `BACKOFFICE_TEAMS_DIR` | `~/openrig/teams` (or `~/openrig-teams` if that does not exist) | Folder with one sub-folder per rig holding its `rig.yaml`. Agent settings are read and saved there. |
| `OPENRIG_URL` | `http://127.0.0.1:7433` | Where the OpenRig daemon answers. |
| `OPENRIG_TERMINAL_BEARER_TOKEN` | unset | Only if your daemon was started with tokens. |
| `BACKOFFICE_HARNESSES` | what is installed | Harnesses an agent can be moved to in its Settings tab, e.g. `claude-code,opencode`. Unset: every installed built-in (`claude-code`, `codex`, `pi`), each usable OpenRig community harness, and `opencode` if it is installed. |
| `BACKOFFICE_MODELS_<HARNESS>` | unset | Models suggested for one harness, e.g. `BACKOFFICE_MODELS_OPENCODE=opencode/big-pickle,anthropic/claude-sonnet-5-5`. Unset: Claude Code suggests fable/opus/sonnet/haiku and opencode lists its own (`opencode models`). Any id can still be typed. |
| `BACKOFFICE_PERSON` | OpenRig's default person | Who tasks created on the board come from, e.g. `hanns@external` (see `rig gateway participants`). |

Controls: drag to move, scroll to zoom, right-drag to turn, click an agent (or its row in the list)
to open it, `Follow` to keep the camera on it, `Esc` to close. The panel opens on the agent's
**Terminal** tab; its **Settings** tab lists the agent's parameters (rig, pod, session, harness,
model, status, context, work) and lets you change its harness, model, skills and tool rules.

### Task board

**Task board** in the top bar opens one board for every team. The chips at the top filter it to one or
more rigs (the choice is remembered), and **Tasks** next to a rig in the list opens it filtered to that rig.
The columns are OpenRig's queue states: To do, In progress, Blocked, and Done for the last seven days.

**New task** puts a row in OpenRig's queue for the agent you pick, from you, and OpenRig tells the agent.
It defaults to the team's lead, who shares the work out in the team. A team without a lead (such as
`duo`) defaults to its first seat: in `duo` that is `dev.build`, who builds and hands the change to
`dev.review`. The agents claim, move and close their own tasks; the board shows what they did. The one
thing you can do to a task yourself is **Cancel** it (closed in OpenRig as canceled, with your reason).

### Where agents keep their files

The Settings tab's **Working folder** is the agent's `cwd:` in its rig's `rig.yaml`: where it works
and writes its files. When other agents of the rig share the folder, you choose whether only this agent
moves or all of them; agents with a folder of their own stay where they are. OpenRig is told too
(`rig seat set-cwd`), and the folder is used from each agent's next fresh launch. Files already in the old
folder are not moved. OpenRig's own records (missions, slices, specs) are kept in one folder for all
rigs, shown under the form; change that with `rig config set workspace.root <folder>`.

### Changing an agent's harness

Settings are saved where OpenRig reads them: the agent's entry in its rig's `rig.yaml` (harness,
model, tool rules) and its `agent.yaml` (skills). Changing the harness ends the agent's current
conversation, so the office asks first.

- **To Claude Code, Codex or Pi:** the team file is changed and OpenRig moves the running seat
  straight away (`rig seat set-runtime`). A successor starts on the new harness, reads a handover and
  takes over the seat, keeping its address, edges and queued work.
- **To opencode** (or another community harness): OpenRig cannot move a running seat there, so only
  the team file changes. The agent starts on opencode, with a fresh conversation, the next time the
  rig is brought up from its file (`rig up <rig.yaml> --plan` previews that). The first time opencode
  is picked, the office installs it for OpenRig: `opencode.yaml` and `opencode-launch.sh` in OpenRig's
  `community-harnesses` folder (an existing preset is never overwritten). The launcher hands the
  seat's model to opencode as `OPENCODE_CONFIG_CONTENT`, because opencode's interactive command has
  no `--model` flag. The agent panel can be dragged by its
header and resized from its left, right and bottom edges; double-click the header to put it back.

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
   message box sends your text to the server, which types it into that agent's prompt. If the agent
   is stopped at a numbered question, the panel offers its choices as buttons.

The browser never talks to OpenRig or to the agents directly. Everything goes through the office
server, and the office server only listens on the VPS itself. That is why you need the tunnel.

### What you see for each agent

| The agent is… | In the office | Meaning |
|---|---|---|
| Working | At its desk, typing, monitor lit | It is in the middle of a turn. |
| Idle | On a sofa in the lounge, its desk monitor off | It finished and is waiting for work. It walks to its desk when work starts. |
| Idle, waiting on a PR | On a chair in the PR review room | It is idle and one of its open queue items mentions a PR, a pull request or a review. |
| Needs you | At its desk, orange bubble with the reason, counted in its team's header | It stopped at a question or a permission prompt and will not continue until someone answers in its terminal. |
| Unknown | Greyed out, in the lounge | OpenRig cannot tell (for example, the session is gone). |

The office is built from the rigs that are running. Every pod gets a bench of its own, exactly as
many desks as the pod has seats, in its own shirt colour; a pod too big for one bench is split over
two. Benches fill rows across the open plan, and when a rig grows the office grows towards the open
front, so the back rooms stay where they are. The OpenRig `kernel` team (the operator and its
helpers) has its own glass room, with a bench outside it if it has more than eight seats. The lounge
gets another group of sofas for every 13 agents, so every agent has a seat even when all of them are
idle. A desk's monitor is lit only while its owner is at it.

The list on the left is grouped by rig, then by pod. The agent whose name ends in `.lead` is marked
as the team's lead, with a star on its name tag in the office.

OpenRig does not report a pull-request state, so "waiting on a PR" is read from the words of the
queue items. It is a guess, and it can be wrong.

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
- Agent panel: work counts, context used, open tasks, the live screen, and a message box. It can be
  moved and resized, and remembers where you left it.
- Answering an agent: when an agent is stopped at a numbered question (for example a permission
  prompt with "1. Yes / 2. … / 3. No"), the panel shows one button per choice.
- Agent settings: the **Settings** button in the panel shows one agent's model, skills and tool
  rules, and saves changes to the team files (see below).
- Two looks, switchable from the top bar: **Studio** and **Night shift**.
- The standup room, QA lab, gym and janitor closet are in the building but not wired
  to anything yet. Layout editing, music, GitHub and Jira are also not built yet.

Three things in the office act on a real agent:

- **The message box** types your text into the agent's prompt, exactly like `rig send`. OpenRig
  refuses it while the agent is stopped at a question.
- **The answer buttons** press one digit in the agent's terminal, which picks that choice. This is
  the same as you pressing the key there, so "Yes" really approves the command shown above it.
  The server reads the screen again first and presses nothing if that question is no longer the
  one on screen. OpenRig records each answer in its audit log.

- **Saving settings** edits the files OpenRig builds the team from, and nothing in OpenRig itself:
  - Model and tool rules go to the agent's entry in `<teams dir>/<rig>/rig.yaml` (`model`,
    `claude_permissions`). Skills go to the `agent.yaml` that entry points at
    (`profiles.<profile>.uses.skills`); agents built from the same `agent.yaml` share them.
  - Only the lines for that setting change, and the previous file is kept beside it as `.bak`.
  - OpenRig keeps its own record for a seat that already exists, so the office also runs
    `rig seat set-model` and `rig seat set-permissions` for it. Those take effect at the agent's
    next restart; nothing changes in the running conversation.
  - Skills reach an agent only when it is launched fresh.
  - Rigs without team files, such as the built-in `kernel`, are shown as not editable.

There are no buttons that stop, reset or relaunch agents.

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
desk benches and furniture positions. `assignSeats()` gives every agent a home desk: pods stay
together and nobody changes desk when a status changes. `locateAgents()` then says where each agent
is right now (its desk, the lounge or the review room), following `whereabouts()` in
`packages/core/src/behavior.ts`.

### Use something other than OpenRig

Implement the five methods of `OfficeSource` (`packages/core/src/source.ts`) and pass it to
`startServer()`. `MockSource` is a small example.

## Develop

```sh
./node_modules/.bin/bun test             # core, OpenRig adapter and server
./node_modules/.bin/bun run check        # type-check the frontend
./node_modules/.bin/bun run dev:server   # server with reload
./node_modules/.bin/bun run dev:web      # Vite on http://127.0.0.1:47832, proxying to the server
```
