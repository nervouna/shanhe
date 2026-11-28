# Shanhe 山河

Repository: `nervouna/shanhe` (the local folder is still named `china-civ`). A browser-based, turn-based 4X strategy game on a map of East Asia (including Siberia) and Southeast Asia, with 50 fictional nations drawn along real province-level borders. The project is a showcase of what an LLM can build.

## Status

Design is locked and the code is under construction. Progress is tracked in the repository's milestones and the tracking issue (#2); what only the owner can verify is in #1.

## How this project is developed

This project is developed with the `orchestrate` skill: an orchestrator session plans milestones as issues, writes each issue as a spec, dispatches Claude subagents to implement and open PRs, reviews by re-running the acceptance commands, and merges.

- **Implementers and reviewers run on the Fable model.** The project is a showcase of that model, so no other model writes its code. Each PR's delivery record states the model.
- **The goal**: the game is playable in real Chrome, and independent-context reviewer subagents pass it on each dimension of the rubric in the tracking issue.
- **Anything only the user can verify** (touch-screen play, for example) is collected in the user-verification issue and never blocks development.

## Where things are

- `docs/design/` is the source of truth for the game's design. Start at `docs/design/00-overview.md`; `docs/README.md` indexes the rest.
- `docs/design/07-open-questions.md` lists what is undecided. Settle an item with the user before building the system it touches, then update the docs.

## Settled decisions

Everything in `docs/design/` is settled. On 2026-11-28 the user stated that whatever Claude and the user agreed on in the design discussion counts as decided, including proposals Claude made and the user accepted without detailed review. Do not reopen these without a reason.

The ones that constrain all work:

- **Visuals are purely procedural.** No hand-made, AI-generated or third-party models or textures. Public geographic datasets (elevation, borders, rivers, land cover) are allowed as input data; check each dataset's licence before using it.
- **Browser platform**: Three.js on WebGPU with a WebGL fallback. Mouse, keyboard and touch are all supported.
- **Chinese and English UI.**
- **Units are xiangqi-style pieces**, not figures. Leaders are not shown; they are a name and a permanent buff.
- **A game lasts about two hours** (150 turns), from the ancient to the modern era.
- **Nation names are fictional**; keep the Chinese names as written in `docs/design/02-nations.md`.
- **The look and UI are original**: the game borrows 4X mechanics, not the Civilization series' visuals, UI, leaders, text or music.

## Working conventions

- The project exists to show what Claude can do, and the user expects Claude to make design calls. For a gap in the design, propose a concrete answer with a recommendation; do not hand back an open question.
- When a design point changes, update the relevant doc in the same piece of work, so code and docs do not disagree.
- Numbers in the design docs are directions, not balanced values.
- Audio has not been discussed. The procedural rule is assumed to cover it.

## Machine load

The development machine is shared with the owner's other work. Rules for every agent:

- Run one heavy job at a time: never a headless browser, a full test run and a build side by side.
- Headless Chromium renders in software on every core. Under automation (`navigator.webdriver`) the page must cap its frame rate at a few frames per second, and long game runs (many turns) must run with rendering paused. Playwright uses one worker.
- Start heavy commands with `nice -n 10`. Vitest is limited to two workers in `vite.config.ts`.
- Give every long command a timeout, and stop every process you started before you report.
- Stop a process by its PID. If you use `pkill` or `pgrep`, put options before the pattern (`pkill -P 1 -f pattern`): on macOS anything after the pattern is read as another pattern, so `pkill -f pattern -P 1` kills every process whose command line contains "1". Never hide its errors with `2>/dev/null`.

## Technology

### Stack

- TypeScript in strict mode, built with Vite, tested with Vitest, linted with ESLint and typescript-eslint. npm is the package manager; Node 24 or later.
- Three.js, imported from `three/webgpu`. `WebGPURenderer` uses WebGPU where the browser has it and switches to its WebGL 2 backend by itself during `await renderer.init()`; `renderer.backend.isWebGPUBackend` tells which one is active. Three.js's WebGPU API changes fast: check the current documentation or the installed package's sources before relying on a specific API.
- The UI is plain DOM. There is no UI framework and no state-management library.
- TypeScript stays on 6.0.x until typescript-eslint supports TypeScript 7.

### Layout

| Path | Content |
|---|---|
| `src/shared/` | Types, hex maths (`hex.ts`), the `MapData` contract (`mapData.ts`), the fixture map (`fixtureMap.ts`), i18n (`i18n.ts`) |
| `src/core/` | Rules. Pure functions on plain data; runs in Node |
| `src/render/` | Three.js |
| `src/ui/` | The game loop host (`host.ts`), the turn worker, and the interface in plain DOM: `app.ts` wires it, `overlays.ts`, `polityPanel.ts`, `kitPanel.ts` and `cityTrade.ts` draw the overlays and panels, `icons.ts` holds the icons as path data, and the modules without DOM (`pending.ts`, `techTree.ts`, `diplomacy.ts`, `routes.ts`, `animation.ts`, `scale.ts`, `lens.ts`, `rules.ts`, `path.ts`, `board.ts`, `kit.ts`, `aids.ts`, `settings.ts`, `sound.ts`, `sight.ts`, `notes.ts`, `difficulty.ts`, `hexCard.ts`, `touchOrder.ts`, `focus.ts`, `text.ts`, `settle.ts`, `observer.ts`) hold what they show, store and play. `sight.ts` is the fog of war as the interface applies it: whatever is drawn, planned or reported for a player goes through it. The styles are in `index.html` |
| `src/main.ts` | Wires the layers and exposes `window.__shanhe = { backend, state, render, ui, startGame({ nation, observe, seed, map, difficulty }), endTurn(), runTurns(n) }` for automated checks. `ui` is a snapshot: `screen`, `panel` (`menu`, `kit`, `city`, `polity` or null), `overlay` (`tech`, `policy`, `polities`, `victory` or null), `city`, `polity`, `selectedUnit`, `busy`, `observer`, `mainButton`, `notifications`, `map`, `lens`, `scale`, `animating`, `targeting`, `routePreview`, `enterApplied`, `kit` (`{ nation, where }`: the kit on screen, at `start`, as the player's `own` or in a `polity` panel), `start` (nation select: `region`, `sort`, `nations`, `chosen`, `difficulty`), `settings` (`quality`, `scale`, `language`, `animationSpeed`, `volume`, `muted`), `sound` (`silent`, `unlocked`, `volume`, `muted`, `era`) `aids` (the selection aids of the selected piece: `reachable`, `path`, `turnEnds`, `attackTarget`), `fog` (the scene the renderer has: `on`, `hiddenUnits`, `foreignUnits`), `card` (the details card of a hex on screen, or null: `hex`, `knowledge`, `units`, `city`, `by` the pointer at rest or a long press, `text`), `touchTarget` (the hex a first tap left pending) with `touchOrders` (orders a second tap gave), and `settleSites` (the city sites marked for a selected settler, each with `hex` and `turns`). `observer` also has `watching` (the hex its camera went to for an event) and `returns` (the times it came back) |
| `tools/` | Node scripts (`sim.ts`, `check-assets.ts`) and `tools/pipeline/`, the build-time map pipeline |
| `public/data/` | Generated map files: `.json` and `.bin` only |

### Layer rules

Dependencies go one way, and tools enforce them:

- `src/shared` imports nothing from the other layers.
- `src/core` imports only `src/shared`. Neither of the two may use the DOM, `three`, `src/render` or `src/ui`.
- `src/render` may not import `src/ui`. `src/ui` may not import `three`.
- `npm run lint` fails on a forbidden import (`no-restricted-imports` in `eslint.config.js`). `npm run typecheck` checks `src/core` and `src/shared` with `tsconfig.core.json`, which has no DOM lib, so using `document` or `localStorage` there fails.

Conventions that keep this working:

- Relative imports carry the `.ts` extension and there are no path aliases, so Node can run `tools/*.ts` directly and the lint patterns cannot be bypassed.
- Only erasable TypeScript syntax: no `enum`, no namespaces, no parameter properties. Use `as const` objects for codes.
- The UI never changes a `GameState`: it sends actions to the host in `src/ui/host.ts` and redraws from the state that comes back. It reads the rules through the query functions of `src/core/query.ts`, which take a `GameState`; it does not build the rules' working context itself. The turn worker (`src/ui/turnWorker.ts`) imports `src/core` and `src/shared` only; lint enforces it.
- The page opens on the real map; `?map=fixture` opens the fixture map, `?demo=render` the render demo, and `?render=off` draws nothing. Under automation (`navigator.webdriver`) the renderer is capped at 4 frames per second, the interface animates nothing (it never calls `renderer.play`) and makes no sound (it never creates an audio context), and `runTurns` pauses the renderer while it runs.
- Every user-facing string goes through `t()` in `src/shared/i18n.ts`, with a Chinese and an English entry. Only `src/ui` touches `localStorage`.
- Tests sit next to the code as `*.test.ts`.

### Commands

| Command | What it does |
|---|---|
| `npm ci` | Install dependencies |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the tests once |
| `npm run typecheck` | Type-check the core without the DOM, then the app, the tools and the e2e project |
| `npm run lint` | ESLint, including the layer rules |
| `npm run check:assets` | Fail if a model, texture, image, audio, video or font file is tracked outside `docs/images/` |
| `npm run sim -- --map <fixture\|synthetic\|path> --turns 150 --seed N` | Play an AI-only game headless and print a summary; `--seeds 1-30` runs a batch with a victory tally, `--difficulty relaxed\|easy\|standard\|hard\|severe` sets the level (`standard` by default; with nobody playing, only Hard and Severe change anything: they are the AI's bonus), `--report` adds per-nation, per-era diagnostics |
| `npm run pipeline` | Rebuild `public/data` from public datasets (downloads into `data/raw/`; `-- --offline` uses the cache) |
| `npm run pipeline:check` | Validate the committed map data |
| `npm run e2e` | Build, serve and test the page in headless Chromium (Playwright, one worker): the renderer, an observer game to its end and a player game on the fixture map. `SHANHE_REAL_MAP=1` adds a 150-turn observer game on the real map |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, build, check:assets and e2e on pushes to `main` and on pull requests.
