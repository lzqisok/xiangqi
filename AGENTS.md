# AGENTS.md

## Project Overview

This repository is a pnpm workspace for a web Chinese chess application powered by Pikafish.

- `client/`: React 18, TypeScript, Vite frontend.
- `server/`: Node.js, Express, WebSocket backend that talks to Pikafish through UCI.
- `engine/`: local Pikafish binary and `pikafish.nnue` weights. These files are required at runtime but are prepared manually.

## Common Commands

Run commands from the repository root unless noted otherwise.

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
```

Package-specific commands:

```bash
pnpm --filter client dev
pnpm --filter client build
pnpm --filter client test

pnpm --filter server dev
pnpm --filter server build
pnpm --filter server test
```

## Runtime Ports

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- WebSocket: `ws://localhost:3001/ws`

## Development Notes

- Keep changes scoped to the relevant package and existing module boundaries.
- Prefer existing patterns in `client/src/engine`, `client/src/hooks`, `client/src/components`, and `server/src` before adding new abstractions.
- Client-side game rules, notation, and board logic live under `client/src/engine`.
- Shared gameplay state flow is centered around `client/src/hooks/useGame.ts` and `client/src/hooks/gameFlow.ts`.
- WebSocket protocol types and validation are split between `server/src/protocol.ts`, `server/src/validation.ts`, and `client/src/types.ts`.
- Do not commit generated build output, local engine binaries, temporary logs, or dependency directories.

## Testing Guidance

- Add or update focused tests when changing rules, validation, storage, protocol behavior, or game-flow state transitions.
- Prefer package-level tests while iterating:

```bash
pnpm --filter client test
pnpm --filter server test
```

- Run `pnpm build` before finishing changes that touch TypeScript contracts, Vite configuration, or server runtime code.

## Engine Requirements

The app expects Pikafish files under `engine/`:

```text
engine/
├── pikafish
└── pikafish.nnue
```

On Windows, the binary is expected as `engine/pikafish.exe`. Keep these runtime artifacts out of source changes unless a task explicitly asks to update engine setup.

## Style And Contribution Conventions

- Use TypeScript and keep types explicit where they clarify cross-module contracts.
- Keep UI changes consistent with the existing Canvas board and React component structure.
- Avoid unrelated formatting-only churn.
- Commit messages should follow the existing convention from `CONTRIBUTING.md`:

```text
<type>: <summary>
```

Common types include `feat`, `fix`, `docs`, `refactor`, `test`, and `chore`.
