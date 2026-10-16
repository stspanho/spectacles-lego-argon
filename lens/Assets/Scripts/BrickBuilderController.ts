import { makeLog } from "./Log";
import { BrickApi } from "./BrickApi";
import { BrickButton } from "./BrickButton";
import { BrickCamera } from "./BrickCamera";
import { DustFx } from "./BrickDust";
import { BrickModel } from "./BrickModel";
import { Design, Inventory, Job, hexToColor } from "./BrickTypes";
import { BuildArea } from "./BuildArea";
import { HandsAwayTrigger } from "./HandsAwayTrigger";
import { HudLabel } from "./HudLabel";
import { PileMarkers } from "./PileMarkers";
import { SurfaceCalibration } from "./SurfaceCalibration";
import { SurfaceProjector } from "./SurfaceProjector";
import { WorldCamera } from "./WorldCamera";

const log = makeLog("BrickBuilder");

const FINALE_HOLD = 5; // s the finished hologram + sign stay before fading
const FINALE_FADE = 1.5; // s of fade

type State = "boot" | "calibrate" | "aim" | "countdown" | "scanning" | "designing" | "placeBuild" | "preview" | "build" | "done" | "error";

/**
 * Brick Builder on Specs.
 *   1. hand on the table (SurfacePlacement) = the scan spot
 *   2. TAKE PHOTO (head-locked button) -> photo to the laptop backend (Gemini 4 Argon, over the tunnel)
 *   3. detected pieces: small ghost bricks hovering above the real ones
 *   4. design ready -> hand on the table again = the BUILD AREA (glowing border, transparent full preview,
 *      START plate in front on the table)
 *   5. steps: the pieces to place drop in as ghosts, their instances glow on the pile; BACK / NEXT plates
 *      (optionally also "hands away from the build" when handsAwaySeconds > 0)
 */
@component
export class BrickBuilderController extends BaseScriptComponent {
  @input
  @hint("Camera Module asset. The @input binding is what declares the Camera capability on device.")
  cameraModule: CameraModule;

  @input
  @hint("The device-tracked Camera (Camera Object).")
  worldCamera: Camera;

  @input
  @hint("Assets/Shaders/BrickHolo.mat")
  holoMaterial: Material;

  @input
  @hint("Assets/Shaders/BrickDust.mat")
  dustMaterial: Material;

  @input
  @hint("Backend base URL, e.g. https://xxx.trycloudflare.com")
  apiBase: string = "https://rev-contain-outer-orbit.trycloudflare.com";

  @input
  @hint("ACCESS_TOKEN from the backend .env (device / tunnel only)")
  accessToken: string = "";

  @input
  @hint("Editor only: a local token-less backend instance (HOST=127.0.0.1 ACCESS_TOKEN= PORT=8798). Empty = use apiBase.")
  editorApiBase: string = "http://127.0.0.1:8798";

  @input
  @hint("Optional theme for the design, e.g. 'a robot'")
  theme: string = "";

  @input
  @widget(new ComboBoxWidget([new ComboBoxItem("LOW", "LOW"), new ComboBoxItem("MEDIUM", "MEDIUM"), new ComboBoxItem("HIGH", "HIGH")]))
  thinking: string = "MEDIUM";

  @input
  @hint("0 = off. Otherwise: seconds both hands must stay away from the build before the step counts as done (besides NEXT)")
  handsAwaySeconds: number = 0;

  @input
  @hint("cm to lower the hand-calibrated plane (SurfacePlacement's estimate floats ~1 cm above the table). Negative raises it.")
  surfaceDrop: number = 1.0;

  @input
  @hint("Experimental: table height from the lowest tracked fingertip near the calibration point instead of the fixed drop (sank the area on device when the other hand hung lower)")
  fingerHeight: boolean = false;

  @input
  @hint("Editor only: plant the table in front of the camera and advance steps on a timer")
  editorSim: boolean = true;

  @input
  @hint("Editor only: seconds per build step")
  editorStepSeconds: number = 5;

  private state: State = "boot";
  private backend: BrickApi;
  private cam: WorldCamera;
  private projector: SurfaceProjector;
  private calibration: SurfaceCalibration;
  private hud: HudLabel;
  private dust: DustFx | null = null;
  private model: BrickModel | null = null;
  private pile: PileMarkers | null = null;
  private area: BuildArea | null = null;
  private captureButton: BrickButton | null = null;
  private camIcon: BrickCamera | null = null; // brick-built camera hovering over TAKE PHOTO
  private trigger: HandsAwayTrigger;

  private job: Job | null = null;
  private frameId = -1;
  private inventoryShown = false;
  private poll: DelayedCallbackEvent;
  private stepTimer: DelayedCallbackEvent;
  private scanSpot: vec3 | null = null;
  private buildSpot: vec3 | null = null;
  private lastTick = 0;
  private stepIndex = 0;
  private stepStartedAt = 0;
  private aimStartedAt = 0;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.start());
    this.createEvent("UpdateEvent").bind(() => this.tick());
  }

  private isEditorSim(): boolean {
    return global.deviceInfoSystem.isEditor() && this.editorSim;
  }

  private start() {
    const isEditor = global.deviceInfoSystem.isEditor();
    const base = isEditor && this.editorApiBase ? this.editorApiBase : this.apiBase;
    this.backend = new BrickApi(this, base, this.accessToken);
    log.i("backend " + base + " token=" + this.backend.tokenLength() + " chars");
    this.cam = new WorldCamera(this.cameraModule);
    this.calibration = new SurfaceCalibration(this, this.holoMaterial || null, this.surfaceDrop, this.fingerHeight);
    this.projector = new SurfaceProjector(() => this.worldCamera, () => this.calibration.getSurfaceY());
    this.hud = new HudLabel(this.worldCamera);
    this.trigger = new HandsAwayTrigger(this.worldCamera);
    this.trigger.init();
    this.trigger.awaySeconds = this.handsAwaySeconds;
    this.trigger.onFire = () => this.onStepDone("hands away");
    if (this.holoMaterial) {
      this.model = new BrickModel(this.holoMaterial);
      this.pile = new PileMarkers(this.holoMaterial);
      this.area = new BuildArea(this.holoMaterial, () => this.onStartPressed(), () => this.onNextPressed(), () => this.onBackPressed());
      // head-locked, under the HUD text, leaning back toward the viewer
      this.captureButton = new BrickButton(this.hud.getObject(), this.holoMaterial, "TAKE PHOTO", () => this.onCapturePressed(), new vec3(0, -20, 0), { tilt: 0.6, studsX: 6, studsZ: 3, touch: true }); // under the HUD text, leaning back toward the user so the studded top + cap show; label on the front
      this.camIcon = new BrickCamera(this.hud.getObject(), this.holoMaterial, new vec3(0, -6.0, -3), 1.8); // floats over the button, larger than life: "this takes a picture"
    } else log.e("holoMaterial not wired");
    if (this.dustMaterial) this.dust = new DustFx(this.dustMaterial);
    else log.e("dustMaterial not wired");
    this.poll = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    this.poll.bind(() => this.pollJob());
    this.stepTimer = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    this.stepTimer.bind(() => { if (this.state === "build") this.onStepDone("editor timer"); });

    this.backend.health().then((h) => log.i("backend ok: " + h.model + (h.mock ? " (MOCK)" : "") + " thinking=" + h.thinking))
      .catch((e) => log.e("backend health failed (" + base + "): " + e));

    this.calibrateTable();
  }

  // ---------- 1. table (= scan spot) ----------
  private calibrateTable() {
    this.state = "calibrate";
    if (this.isEditorSim()) {
      const ct = this.worldCamera.getSceneObject().getTransform();
      const fwd = ct.back;
      const flat = new vec3(fwd.x, 0, fwd.z).normalize();
      // free space in the preview's simulated room (its furniture occludes anything lower / farther)
      const pos = ct.getWorldPosition().add(flat.uniformScale(40)).add(new vec3(0, -16, 0));
      this.calibration.setPlane(pos, quat.angleAxis(Math.atan2(flat.x, flat.z), vec3.up()));
      this.onTableCalibrated();
      return;
    }
    // SurfacePlacement shows its own hand hint; keep our HUD out of the way until the table is locked
    this.hud.setVisible(false);
    this.calibration.start(90, (ok) => {
      this.hud.setVisible(true);
      if (ok) this.onTableCalibrated();
      else { this.state = "error"; this.hud.set("No table found", "pinch TAKE PHOTO to try again"); this.showCapture(); }
    });
  }

  private onTableCalibrated() {
    const plane = this.calibration.getPlane();
    if (!plane) return;
    this.scanSpot = plane.pos;
    log.i("scan spot at " + plane.pos);
    if (this.dust) {
      this.dust.scanCloud(plane.pos, 18);
      this.after(1.2, () => { if (this.dust && this.state === "aim") this.dust.stopScan(); });
    }
    this.state = "aim";
    this.aimStartedAt = getTime();
    if (this.isEditorSim()) {
      this.showCapture();
      this.hud.set("Now look at your bricks", "scanning in 3");
      this.after(1, () => this.hud.set("Now look at your bricks", "scanning in 2"));
      this.after(2, () => this.hud.set("Now look at your bricks", "scanning in 1"));
      this.after(12, () => { if (this.state === "aim") this.capture(); }); // fallback; the fake finger presses TAKE PHOTO first
      return;
    }
    this.hud.set(""); // the TAKE PHOTO button says it all (it hangs under the HUD, so the HUD stays enabled)
    this.showCapture();
  }

  private showCapture() {
    if (this.captureButton) this.captureButton.setVisible(true);
    if (this.camIcon) this.camIcon.setVisible(true);
  }

  private onCapturePressed() {
    if (this.state === "aim") this.countdown();
    else if (this.state === "error") { if (this.scanSpot) this.countdown(); else this.restart(); }
  }

  /** 3-2-1 on the HUD before the photo, so the pile can be framed. */
  private countdown() {
    this.state = "countdown";
    if (this.captureButton) this.captureButton.dismiss();
    this.hud.setVisible(true);
    const tickCam = () => { if (this.camIcon) this.camIcon.flash(false); };
    this.hud.set("3"); tickCam();
    this.after(1, () => { if (this.state === "countdown") { this.hud.set("2"); tickCam(); } });
    this.after(2, () => { if (this.state === "countdown") { this.hud.set("1"); tickCam(); } });
    this.after(3, () => { if (this.state === "countdown") this.capture(); });
  }

  // ---------- 2. photo -> backend ----------
  private capture() {
    const tex = this.cam.getTexture();
    if (!tex) { this.hud.set("Camera not ready", "trying again"); this.after(1.5, () => this.capture()); return; }
    if (this.frameId >= 0) this.projector.dispose(this.frameId);
    this.frameId = this.projector.freeze(tex);
    if (this.frameId < 0) { this.hud.set("Camera not ready", "trying again"); this.after(1.5, () => this.capture()); return; }
    this.state = "scanning";
    this.inventoryShown = false;
    if (this.captureButton) this.captureButton.dismiss();
    if (this.camIcon) { this.camIcon.flash(true); this.after(0.5, () => { if (this.camIcon) this.camIcon.setVisible(false); }); } // the shot
    if (this.pile) this.pile.clear();
    this.hud.set("Scanning your bricks...");
    // the "thinking" cloud lives where the hand was put down
    if (this.dust && this.scanSpot) this.dust.scanCloud(this.scanSpot, 30);
    const frozen = this.projector.texture(this.frameId) || tex;
    const t0 = getTime();
    Base64.encodeTextureAsync(
      frozen,
      (b64: string) => {
        log.i("jpeg " + Math.round((b64.length * 3) / 4 / 1024) + " KB in " + (getTime() - t0).toFixed(2) + "s");
        this.backend.createJob(b64, "image/jpeg", this.theme, this.thinking)
          .then((job) => { this.job = job; log.i("job " + job.id); this.poll.reset(2); })
          .catch((e) => this.fail("Could not reach the backend: " + e));
      },
      () => this.fail("Photo encode failed"),
      CompressionQuality.IntermediateQuality,
      EncodingType.Jpg,
    );
  }

  private pollJob() {
    if (!this.job) return;
    this.backend.getJob(this.job.id)
      .then((job) => {
        this.job = job;
        const last = job.log && job.log.length ? job.log[job.log.length - 1].message : job.stage;
        if (job.stage === "error") { this.fail(job.error || "backend error"); return; }
        if (job.inventory && !this.inventoryShown) this.showInventory(job.inventory);
        if (job.design && job.stage === "done") { this.onDesignReady(job.design, job.inventory as Inventory); return; }
        if (this.state === "scanning" || this.state === "designing") this.hud.set(last);
        this.poll.reset(2);
      })
      .catch((e) => { log.w("poll failed: " + e); this.poll.reset(3); });
  }

  // ---------- 3. detections on the pile ----------
  private showInventory(inv: Inventory) {
    this.inventoryShown = true;
    this.state = "designing";
    const total = inv.items.reduce((n, i) => n + i.count, 0);
    this.hud.set("Found " + total + " pieces, designing...");
    if (!this.pile) return;
    const fwd = this.projector.cameraForward(this.frameId) || new vec3(0, 0, -1);
    const markers = this.pile.build(inv, this.projector, this.frameId, Math.atan2(fwd.x, fwd.z));
    if (this.dust) {
      this.dust.stopScan();
      const centre = this.pile.centre();
      if (centre) this.after(0.2, () => this.dust && this.dust.burst(centre, 16, 10, 0.5));
    }
    this.pile.reveal(0.1);
    markers.forEach((m, i) => {
      if (i % 3 === 0 && this.dust) this.after(i * 0.1, () => this.dust && this.dust.converge(m.pos, 7, 0.35, [hexToColor(m.item.hex)]));
    });
  }

  // ---------- 4. build area ----------
  private onDesignReady(design: Design, inv: Inventory) {
    if (!this.model) return;
    this.poll.cancel();
    this.model.build(design, inv);
    this.state = "placeBuild";
    // the SurfacePlacement hint carries the instruction; our HUD stays out of the way
    this.hud.setVisible(false);
    if (this.isEditorSim()) {
      // farther away along the camera's flat forward, so the area + the flat sign and buttons fit the narrow preview
      const ct = this.worldCamera.getSceneObject().getTransform();
      const f = ct.back;
      const flat = new vec3(f.x, 0, f.z).normalize();
      const p = (this.scanSpot || vec3.zero()).add(flat.uniformScale(40));
      this.after(1.5, () => this.placeBuildArea(p));
      return;
    }
    this.calibration.start(120, (ok) => {
      const plane = this.calibration.getPlane();
      if (ok && plane) this.placeBuildArea(plane.pos);
      else this.after(1, () => this.onDesignReady(design, inv));
    });
    this.calibration.setHintText("Press your hand \n where you want \n to build");
  }

  private placeBuildArea(pos: vec3) {
    if (!this.model || !this.area || !this.job || !this.job.design) return;
    this.buildSpot = pos;
    const camPos = this.worldCamera.getSceneObject().getTransform().getWorldPosition();
    this.area.place(pos, camPos, this.model.bounds.lx, this.model.bounds.lz);
    this.model.setPlane(pos, this.area.rotation());
    this.model.preview();
    this.state = "preview";
    const design = this.job.design;
    this.hud.setVisible(false);
    this.area.setInstruction(design.description + " Pinch START to begin.", 0, 0);
    if (this.dust) this.dust.burst(pos, 20, 16, 0.6, this.paletteOf(design, this.job.inventory as Inventory), 1.6);
    this.trigger.setZone(this.model.worldCentre(), this.model.bounds.lx, this.model.bounds.lz);
    this.area.showStart(true);
    if (this.isEditorSim()) this.after(8, () => { if (this.state === "preview") this.onStartPressed(); });
  }

  private paletteOf(design: Design, inv: Inventory): vec4[] {
    const seen: { [id: string]: boolean } = {};
    const out: vec4[] = [];
    for (const s of design.steps) for (const b of s.bricks) {
      if (seen[b.part]) continue;
      seen[b.part] = true;
      const it = inv.items.find((i) => i.id === b.part);
      if (it) out.push(hexToColor(it.hex));
      if (out.length >= 4) return out;
    }
    return out;
  }

  // ---------- 5. step loop ----------
  private onStartPressed() {
    if (this.state !== "preview" || !this.area) return;
    this.area.showStart(false);
    this.area.showStepButtons(true);
    this.startStep(0);
  }

  private onNextPressed() { if (this.state === "build") this.onStepDone("next"); }
  private onBackPressed() { if (this.state === "build" && this.stepIndex > 0) this.startStep(this.stepIndex - 1); }

  private startStep(i: number) {
    if (!this.model || !this.job || !this.job.design) return;
    const design = this.job.design;
    if (i >= design.steps.length) { this.finish(); return; }
    this.state = "build";
    this.stepIndex = i;
    this.stepStartedAt = getTime();
    this.model.setStep(i);
    if (this.pile) {
      const spots = this.pile.highlightStep(this.model.allPieces(), i);
      if (this.dust) spots.forEach((p, k) => this.after(0.15 * k, () => this.dust && this.dust.converge(p, 6, 0.3)));
    }
    if (this.area) { this.area.setBackEnabled(i > 0); this.area.setInstruction(design.steps[i].instruction, i, design.steps.length); }
    this.hud.setVisible(false);
    this.trigger.setEnabled(this.handsAwaySeconds > 0);
    if (this.isEditorSim()) this.stepTimer.reset(this.editorStepSeconds);
    log.i("step " + (i + 1) + ": " + design.steps[i].instruction);
  }

  private onStepDone(why: string) {
    if (this.state !== "build" || !this.model) return;
    log.i("step " + (this.stepIndex + 1) + " done (" + why + ")");
    this.trigger.setEnabled(false);
    this.stepTimer.cancel();
    // TODO: photo check (POST /api/jobs/:id/check)
    const c = this.model.worldCentre();
    if (this.dust) this.dust.burst(new vec3(c.x, c.y + 2, c.z), 9, 8, 0.4, null, 1.0);
    this.startStep(this.stepIndex + 1);
  }

  private finish() {
    if (!this.model || !this.job || !this.job.design) return;
    this.state = "done";
    this.trigger.setEnabled(false);
    if (this.area) this.area.showStepButtons(false);
    this.model.finish();
    const n = this.job.design.steps.length;
    if (this.pile) this.pile.highlightStep(this.model.allPieces(), n); // nothing left to pick up: no more halo
    if (this.area) this.area.setInstruction("You built " + this.job.design.title + "! " + this.job.design.finale, n, n);
    const c = this.model.worldCentre();
    if (this.dust) {
      this.dust.burst(c, 26, 22, 0.7, null, 2.0);
      this.after(0.4, () => this.dust && this.dust.burst(new vec3(c.x, c.y + this.model!.bounds.top, c.z), 18, 14, 0.5, null, 1.6));
    }
    // a few seconds to read the finale, then the hologram, the build area and the pile markers fade away: the real build stands alone
    this.model.fadeOut(FINALE_HOLD, FINALE_FADE);
    if (this.area) this.area.fadeOut(FINALE_HOLD, FINALE_FADE);
    this.after(FINALE_HOLD + FINALE_FADE, () => { if (this.state === "done" && this.pile) this.pile.clear(); });
    log.i("finale: fading out in " + FINALE_HOLD + " s");
  }

  private fail(msg: string) {
    log.e(msg);
    this.state = "error";
    this.poll.cancel();
    if (this.dust) this.dust.stopScan();
    this.hud.setVisible(true);
    this.hud.set("Something went wrong: " + msg.slice(0, 70) + " - pinch TAKE PHOTO to retry");
    this.showCapture();
  }

  private restart() {
    this.job = null;
    this.inventoryShown = false;
    if (this.pile) this.pile.clear();
    if (this.model) this.model.hide();
    if (this.area) this.area.hide();
    if (this.frameId >= 0) this.projector.dispose(this.frameId);
    this.frameId = -1;
    this.hud.setVisible(true);
    if (this.scanSpot) this.onTableCalibrated();
    else this.calibrateTable();
  }

  // ---------- helpers ----------
  private after(seconds: number, fn: () => void) {
    const ev = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    ev.bind(() => { try { fn(); } catch (e) { log.e("after(): " + e); } });
    ev.reset(seconds);
  }

  private tick() {
    const now = getTime();
    const dt = this.lastTick ? Math.min(0.1, now - this.lastTick) : 0.016;
    this.lastTick = now;
    if (this.hud) this.hud.tick(dt);
    if (this.dust) this.dust.tick(now, dt);
    if (this.model) this.model.tick(now);
    if (this.pile) this.pile.tick(now);
    if (this.area) this.area.tick(now);
    if (this.trigger) this.trigger.tick(now);
    if (this.captureButton) this.captureButton.tick(now);
    if (this.camIcon) this.camIcon.tick(now);
    if (this.isEditorSim()) this.fakeFinger(now);
  }

  /** Editor sim: a fake index finger comes down onto TAKE PHOTO (7 s into aim, time to look at it) and NEXT (1 s into each step), pushes and lifts off. */
  private fakeFinger(now: number) {
    const gesture = (k: number): number | null => { // finger underside vs the cap top: 5 cm above -> 0.6 cm into the cap -> back up
      if (k < 0 || k >= 2.5) return null;
      return k < 1.2 ? 5 - 5.6 * (k / 1.2) : k < 1.9 ? -0.6 : -0.6 + 5.6 * ((k - 1.9) / 0.6);
    };
    let tip: vec3 | null = null;
    if (this.state === "build" && this.area) {
      const dy = gesture(now - this.stepStartedAt - 1.0);
      if (dy !== null) tip = this.area.nextFakeTip(dy);
    } else if (this.state === "aim" && this.captureButton && this.captureButton.isVisible()) {
      const dy = gesture(now - this.aimStartedAt - 7.0);
      if (dy !== null) tip = this.captureButton.fakeTip(dy);
    }
    BrickButton.debugTips = tip ? [tip] : null;
  }
}
