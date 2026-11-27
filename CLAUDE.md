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
| `src/ui/` | Plain DOM |
| `src/main.ts` | Wires the layers and exposes `window.__shanhe = { backend, state, render }` for automated checks |
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
| `npm run typecheck` | Type-check the core without the DOM, then the app, then the tools |
| `npm run lint` | ESLint, including the layer rules |
| `npm run check:assets` | Fail if a model, texture, image, audio, video or font file is tracked outside `docs/images/` |
| `npm run sim -- --map <fixture\|synthetic\|path> --turns 150 --seed N` | Play an AI-only game headless and print a summary |
| `npm run e2e` | Build, serve and smoke-test the page in headless Chromium (Playwright) |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, build, check:assets and e2e on pushes to `main` and on pull requests.
