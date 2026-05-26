# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

pnpm monorepo with two packages: `client` (React 18 + Vite) and `server` (Node.js + Express + WebSocket). See `README.md` for full documentation.

### Common commands

| Action | Command |
|---|---|
| Install deps | `pnpm install` |
| Dev (both) | `pnpm dev` |
| Dev client only | `pnpm dev:client` |
| Dev server only | `pnpm dev:server` |
| Build | `pnpm build` |
| Test | `pnpm test` |

No lint script is configured in this repo.

### Ports

- Frontend (Vite): `http://localhost:5173`
- Backend (Express + WS): `http://localhost:3001`, `ws://localhost:3001/ws`

### Pikafish engine setup

The Pikafish chess engine binary and NNUE weight file must be placed in `engine/` at the repo root (`engine/pikafish` + `engine/pikafish.nnue`). This directory is `.gitignored`. Without the engine, the server starts but all AI features are disabled — only local Human-vs-Human mode works.

To set up the engine on Linux x86_64:
1. Download the latest release archive from https://github.com/official-pikafish/Pikafish/releases
2. Extract the appropriate Linux binary (e.g. `Linux/pikafish-avx512` for AVX-512 capable CPUs) and `pikafish.nnue`
3. Place them in `engine/` as `engine/pikafish` and `engine/pikafish.nnue`
4. `chmod +x engine/pikafish`

### Gotchas

- The server resolves the engine path as `path.resolve(process.cwd(), '../engine')`, so it expects to run from the `server/` directory (which `pnpm dev:server` does automatically).
- There is no database — all user data (custom endgames, favorites, study positions) lives in browser `localStorage`.
- Tests use Node's built-in test runner via `tsx --test`. No separate test framework (Jest/Vitest) is needed.
- The `pnpm.onlyBuiltDependencies` field in root `package.json` is set to `["esbuild"]` to avoid interactive build approval prompts.
