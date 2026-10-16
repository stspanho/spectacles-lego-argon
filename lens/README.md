# Lego Argon — Brick Builder lens (Spectacles 2024, Lens Studio 5.15.4 / LS 5.15 CLAD)

Specs client for `~/ideas/spectacles-argon/brick-builder` (laptop backend → Gemini 4 Argon).

Flow: press a flat hand on the table (SurfacePlacement, = the scan spot; the HUD stays hidden during the
hint) -> press or pinch the head-locked **TAKE PHOTO** button (no HUD text in this state: the button and the little
brick-built camera hovering over it say it; the camera pops on every countdown tick and flashes for the shot) -> 3-2-1 on
the HUD (frame the pile) -> the photo goes to the backend while a cloud of mini bricks
hops around the hand spot -> detected pieces appear as small transparent bricks hovering above the real ones ->
design ready: press a flat hand again (the SurfacePlacement hint now says "where you want to build") = the
**build area**: glowing border sized to the footprint, the finished model SOLID inside (steps go transparent
once building starts; every placed piece also carries a depth-only twin, so the far border bar and later ghosts
are hidden behind the real bricks instead of drawing through them), and FLAT on the table in
front of it (nothing stands between you and the build): the step row (mini 2x2 bricks, solid yellow once done,
ghost grey until then, + "n / N"), the big white instruction text, and the green **START** brick -> steps: the
pieces to place drop in as glowing ghosts,
their instance on the pile grows a little, brightens a little and gets an additive halo on the table while the
others fade back;
**BACK / NEXT** buttons: press them like real buttons (an index finger coming down onto the round plate
pushes the cap along; it fires after 0.12 s at 0.1 cm depth anywhere within 2 cm of the plate, has a 1 s
cooldown and must lift back to cap level before the next press, so a hand sweeping through or resting on it
after a press does nothing; pinching still works too; `handsAwaySeconds` > 0
additionally completes a step when both hands leave the build) -> finale on the sign + bursts (the pile
markers all go dim: nothing left to pick up), and 5 s later the hologram, the build area and the pile markers
fade out over 1.5 s (`FINALE_HOLD` / `FINALE_FADE` in the controller) so the real build stands on its own. The head-locked HUD only
carries short status lines (scanning, errors).

Pieces render by shape: `shapeOf()` in `BrickTypes.ts` maps Argon's id/description to box / wedge (slope) /
curved / frame (window, door) / arch (opening at the bottom: "arch", "bridge", "tunnel") / halfpipe (dip on
TOP: "inverted arch", "curved cutout", "half-pipe") / round / flower; meshes come from
`getShapeMesh()` in `BrickMeshes.ts`. Offline check of a saved run's mapping + layout:
`cd ~/ideas/spectacles-argon/brick-builder && npx tsx test/lens-shapes.ts <run id>`.

The SurfacePlacement hand hint is rethemed on start (`SurfaceCalibration.retheme`), all white: ghost hand (two
skinned hand meshes, left/right, lying on the package's depth-writing grid quad: our material neither writes nor
tests depth for them, otherwise they speckle on device; and that state is written AFTER `mainMaterial` is bound,
because 5.15 drops render state / uniforms set on an unbound clone for some meshes), white ring, the package's dot lattice hidden (`dotsColor` = clear) and replaced by ~40 small white ghost bricks standing
on the hint quad (parented to `PortalCircle`, laid out from the quad mesh's AABB), and the progress shown as a
white disc filling the ring from the centre: TableTop writes its stable-frame progress into `InnerCircleMask`
(which natively eats the ring away clockwise); we read it in LateUpdate, reset it to 0 so the ring stays whole,
scale our disc by sqrt(progress) and fade the words out. In the editor (no hands) the fill is demoed on a loop.

## Scene
- `BrickBuilder` SceneObject → `BrickBuilderController` (the only script in the scene). Inputs:
  `cameraModule` (Camera Module asset), `worldCamera` (Camera Object), `holoMaterial` / `dustMaterial`
  (`Assets/Shaders/*.mat`), `apiBase` (tunnel URL), `accessToken` (ACCESS_TOKEN from the backend `.env` —
  **paste it in the Inspector**, it is not in the code), `theme`, `thinking`, `handsAwaySeconds`,
  `surfaceDrop` (SurfacePlacement's plane sits at the hand joints, ~1 cm above the table, so the build area
  looked like it floats: the plane is lowered by this many cm; the log line "table height: ..." shows the
  numbers) + `fingerHeight` (experimental, OFF: lowest tracked fingertip near the calibration point instead —
  the unfiltered version sank the area 2 cm on device because the other hand hung lower),
  `editorSim` + `editorStepSeconds` + `editorApiBase` (editor loop, see below). Scene values win over script
  defaults (LS freezes @input values when the component is added) — change them in the Inspector.
- `Example Surface [EDIT ME]` (SurfacePlacement example) is disabled on purpose; the package is driven from
  `SurfaceCalibration.ts` instead.

## Scripts (`Assets/Scripts/`)
| File | Role |
|---|---|
| `BrickBuilderController.ts` | state machine: calibrate → aim → scanning → designing → preview → build → done |
| `BrickTypes.ts` | mirror of `brick-builder/shared/types.ts` + the stacking layout (`layoutPieces`), cm units |
| `BrickMeshes.ts` | MeshBuilder DUPLO bricks (cached per footprint), shape variants, the fill disc + the mini brick used by the particles. CCW winding = front face (the cylinder sides/caps were inside-out until 2026-10-15: studs showed as crescents on device) |
| `BrickModel.ts` | the hologram model: preview reveal, per-step drop-in + pulse, placed pieces fade (+ a colour-masked occluder twin at renderOrder 2 so they hide what is behind them), finale wave |
| `PileMarkers.ts` | small transparent bricks hovering above each detected brick (photo boxes -> table); rise on reveal, bob; the step's instances brighten a little + get an additive halo on the table, the rest dim while building |
| `BrickCamera.ts` | the brick-built camera icon over TAKE PHOTO: white 4x2 body, lens toward the user (`getLensMesh`, a +z cylinder), red shutter + yellow flash on the front studs; bobs, pops on countdown ticks, flashes on the shot |
| `BrickButton.ts` | pinchable button built like the LEGO-fan "button box": white brick box with a fully studded top (`getBrickMesh(..., clearR)` leaves a round clear patch) on a tan base, grey round studded plate in that patch, a round coloured cap (the actual button: rises on hover, snaps into the plate and springs back on press), label printed in dark ink on the box's front face (SIK Interactable + box collider; all four buttons additionally take a finger press via SIK HandInputData index tips in button-local space, `touch: true`, so the tilted head-locked one is pressed along its own axis): head-locked TAKE PHOTO (red cap, leaning 0.6 rad toward the user so the studded top + cap show), flat START (green) / NEXT (blue) / BACK (grey) on the table |
| `BuildArea.ts` | world-locked build area: glowing border (chasing glow, corner studs), then flat on the table: step row (mini bricks that shrink to fit when there are many steps, + counter), big instruction text, the three brick buttons |
| `BrickDust.ts` | instanced mini-brick particles (one draw call per layer): scan cloud, bursts, converge pops |
| `SurfaceProjector.ts` | frozen camera pose + intrinsics → ray through a photo point → table plane |
| `SurfaceCalibration.ts` | SurfacePlacement NEAR_SURFACE hand calibration (deferred stop, see spectacles-lego) |
| `WorldCamera.ts` | device camera request with the id fallback list (Default_Color → Right_Color → …) |
| `HandsAwayTrigger.ts` | "hands worked at the build, then stayed away" detector + pinch |
| `BrickApi.ts` | InternetModule fetch client (`/api/health`, `POST /api/jobs/b64`, `GET /api/jobs/:id`) |
| `HudLabel.ts` | head-locked instruction text |
| `Log.ts` | print()-based logger (shows up in RunAndCollectLogs) |

## Shaders (`Assets/Shaders/`)
GLSL sources → `python3 tools/build_shaders.py` → `.ss_graph` + `.mat` (+ `.meta` pinning the UUIDs), using
`~/lens-studio/Resources/ss_graph_tool`. Body-only edits while LS runs:
`python3 ~/lens-studio/Resources/ss_graph_tool/ss_graph_tool.py update Assets/Shaders/X.ss_graph Assets/Shaders/X.glsl`.
- `BrickHolo.glsl` — hologram/solid brick shading (`baseColor`, `rimColor`, `ghost`, `pulse`, `reveal`, `alphaMul`).
- `BrickDust.glsl` — instanced mini bricks (`centreW`, `dustA` = radius/progress/mode/size, `dustB` = seed/fade/lift/spin, `colA..colD`).
Both output WORLD positions (the generated graph wires `transformedPosition` straight into Surface.WorldPosition).

## Editor loop (LS 5.15 CLAD)
`editorSim` plants the table 40 cm ahead / 16 cm down (free space in the preview room), puts the build area
40 cm beyond the scan spot along the camera's forward (so the flat text + buttons fit the narrow preview),
pokes TAKE PHOTO 0.5 s into the aim state and NEXT 1 s into every step with a fake index finger
(`BrickButton.debugTips`; `editorStepSeconds` stays as the fallback timer) and talks to a local token-less backend:
```sh
cd ~/ideas/spectacles-argon/brick-builder
HOST=127.0.0.1 PORT=8798 ACCESS_TOKEN= ARGON_MOCK=1 MOCK_RUN=2026-10-14T15-27-23-93815e npx tsx --env-file-if-exists=.env server/index.ts
```
Then RecompileTypeScript → RunAndCollectLogs → screenshot (`ExecuteEditorCode` with
`Ui.IGui` → `IPreviewPanel.screenshot()` → `Pixmap.save(path)`; see the session scratchpad `shot.ts`).

## Device
1. Backend: `npm run dev` (real Argon) + `npm run tunnel`; put the tunnel URL in `apiBase` and the token in `accessToken`. Quick tunnels die after some hours (control-stream failure loop in the log): restart `npm run tunnel`, then update `apiBase` on the component (Inspector / scene-graphql) AND the script default.
2. Send to Spectacles from LS 5.15. Logs stream back (`RunAndCollectLogs mode: tail`).
3. Untested on device yet: SurfacePlacement calibration, camera id, pile projection accuracy, hands-away timing, text size.

Not built yet: the per-step photo check (`POST /api/jobs/:id/check`) — a step is done when NEXT is pinched (or, with `handsAwaySeconds` > 0, when the hands leave the build).
