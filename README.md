# Brick Builder (local prototype)

Photo of DUPLO/LEGO → Gemini 4 Argon makes an inventory → designs a build from only those pieces → an automatic build check (with up to 3 repair rounds) → step-by-step 3D instructions (React + R3F) with the pieces to pick highlighted in the photo.

The backend runs on this laptop; the web app is the first client, a Specs lens can use the same API later.

## Run
```sh
npm install
# put your key in .env → GEMINI_API_KEY=...
npm run dev      # API on :8797, web on :5188
npm run tunnel   # prints https://<random>.trycloudflare.com
```
Open `https://<random>.trycloudflare.com/?token=<ACCESS_TOKEN from .env>` on your phone (the token is remembered after the first visit).

Thinking level: `ARGON_THINKING` in `.env` (default MEDIUM: ~2 min per run vs ~5 min on HIGH); a run can override it with a `thinking` field.

Test without spending credits: `ARGON_MOCK=1 npm run dev`.

## API (for the Specs lens later)
All `/api` calls need header `x-access-token: <ACCESS_TOKEN>` (or `?token=`).

| Method | Path | |
|---|---|---|
| GET | `/api/health` | model name, mock flag |
| POST | `/api/jobs` | multipart `image` (JPEG/PNG/WebP) + `theme` (+ optional `thinking`: LOW/MEDIUM/HIGH) → job (202, runs in background) |
| GET | `/api/jobs/:id` | poll: `stage`, `log`, `inventory`, `design`, `issues` |
| POST | `/api/jobs/:id/redesign` | JSON `{ theme }` → new design from the same inventory |
| GET | `/api/jobs` | recent runs |
| GET | `/api/jobs/:id/image` | the uploaded photo |

Types: `shared/types.ts`. Grid: 1 unit = 1 stud, `layer` = brick height; rotation 0 runs a brick's length along x.

## Files
- `server/argon.ts` — prompts + JSON schemas for the Argon calls
- `shared/validate.ts` — build check (inventory counts, overlaps, baseplate bounds, support in build order)
- `src/components/BuildScene.tsx` — R3F scene: baseplate, bricks, drop-in animation for the current step
- `src/components/PhotoPanel.tsx` — photo with the pieces to pick highlighted
- `runs/<id>/` — every run's photo, job state and raw Argon responses (timing + token usage)

## Specs lens
`~/lens-studio/spectacles-lego-argon/spectacles-lego-argon` (LS 5.15.4). It uses `POST /api/jobs/b64` (JSON `{image: <base64>, mimeType, theme, thinking}`) and polls `GET /api/jobs/:id`.

Editor loop without a token: `HOST=127.0.0.1 PORT=8798 ACCESS_TOKEN= ARGON_MOCK=1 MOCK_RUN=<run id> npx tsx --env-file-if-exists=.env server/index.ts`
(`MOCK_RUN` replays a saved run's inventory + design; `HOST` binds to localhost only).

## Repository layout

- `server/`, `shared/`, `src/`, `test/` — the laptop backend (Express + Gemini 4 Argon), the shared types and the Vite web app.
- `lens/` — the Spectacles lens (Lens Studio 5.15 project). It is a **synced copy** of the project that Lens Studio
  has open at `~/lens-studio/spectacles-lego-argon/spectacles-lego-argon`: `tools/sync-lens.sh` copies it in
  (no `Cache/`, locks or per-machine folders) and blanks the `accessToken` the Inspector stores in
  `Assets/Scene.scene`, so the backend token never reaches git. The pre-commit hook runs the sync on every commit;
  run it by hand after lens changes if you want to see them in `git status` first. On another machine, open
  `lens/spectacles-lego-argon.esproj` in Lens Studio 5.15 and paste the token into the Inspector.
- `tools/video-sound/` — the synthesised soundtrack (music bed + UI clicks and reveals) for the demo video.
- `runs/` (photos + Argon results) and `.env` (keys) stay local.
