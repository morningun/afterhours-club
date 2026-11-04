# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start        # node server.js → http://localhost:3000 (PORT env var overrides)
```

There is no build step, linter, or test suite. To test multiplayer, open several browser tabs against the local server.

Deployment target is Render (Web Service): build `npm install`, start `npm start`. The server must keep reading `process.env.PORT`.

## Architecture

- `server.js` — Express + Socket.IO on one HTTP server. Serves `public/` statically and keeps all player state in an in-memory `players` object keyed by `socket.id` (lost on restart, no persistence). Socket protocol:
  - server → client: `currentPlayers` (full map, on connect), `newPlayer`, `playerMoved` (`{id,x,y,z}`, broadcast to others), `playerUpdated` (full player object, to all), `playerDisconnected` (id)
  - client → server: `playerMove` (`{x,y,z}`), `updateName` (string), `updateColor` (number)
  - Incoming data is not validated; CORS is `*`.
- `public/index.html` — the entire client ("AFTERHOURS — 3D Club"): a single self-contained file with inline CSS, a small UI shell, and one `<script>` containing three.js r160 + postprocessing **bundled and minified inline** together with the app code. Some lines are 20k–190k characters long, so don't Read the whole file; use targeted `grep -o` / `cut` / line ranges. Edits to the minified app logic are hard — prefer adding a separate, readable `<script>` block for new client code.
- **The client currently has no Socket.IO code.** It is a single-player scene (drag to look, WASD move, Shift run, F/DANCE button, mobile joystick `#stick`). Wiring multiplayer requires loading `/socket.io/socket.io.js` (served automatically by the Socket.IO server) and implementing the events above.
- `mousic_ai_prom.html` — an unrelated standalone page (AI music prompt generator, Tailwind CDN); not served by the server (it lives outside `public/`).

UI text and comments are in Korean.
