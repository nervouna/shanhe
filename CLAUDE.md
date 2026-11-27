# Shanhe 山河

Repository: `nervouna/shanhe` (the local folder is still named `china-civ`). A browser-based, turn-based 4X strategy game on a map of East Asia (including Siberia) and Southeast Asia, with 50 fictional nations drawn along real province-level borders. The project is a showcase of what an LLM can build.

## Status

Design is locked; there is no code yet. Progress is tracked in the repository's milestones and its tracking issue.

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

Language, build tooling and project layout are not chosen yet. Record them here, with the build, run and test commands, once they are.

Three.js's WebGPU API changes fast: check the current documentation before relying on a specific API.
