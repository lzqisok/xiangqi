# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

A pnpm monorepo with two workspace packages (`client` and `server`) forming a single product: a web-based Chinese Chess (Xiangqi) application powered by the Pikafish engine. See `README.md` for full details.

### Running in development

```bash
pnpm dev        # starts both client (port 5173) and server (port 3001) via concurrently
pnpm dev:client # client only
pnpm dev:server # server only
```

### Key caveats

- **No lint/test infrastructure exists yet.** The project roadmap lists automated tests and CI as TODO items. There is no ESLint, Prettier, or test runner configured.
- **`pnpm build` has a pre-existing TypeScript error** in `client/src/components/EndgameBoardEditor.tsx` (missing `gameStatus` prop). Dev mode (`vite` / `tsx watch`) is unaffected since it does not run `tsc -b` as a gate.
- **Pikafish engine binary is optional.** The `engine/` directory (containing `pikafish` and `pikafish.nnue`) is not checked into the repo. Without it, the server starts in "local-only mode" — the frontend loads but AI-related features (human vs AI, hints, analysis) are unavailable. Two-player local mode works fully without the engine.
- **No database or external services required.** Persistence uses browser `localStorage`.
- The Vite dev server on port 5173 proxies `/ws` to `ws://localhost:3001` (the server), so both services must be running for WebSocket communication.
