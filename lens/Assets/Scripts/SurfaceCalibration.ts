import { PlacementMode, PlacementSettings } from "SurfacePlacement.lspkg/Scripts/PlacementSettings";
import { SurfacePlacementController } from "SurfacePlacement.lspkg/Scripts/SurfacePlacementController";
import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";
import { makeLog } from "./Log";
import { getBrickMesh, getDiscMesh } from "./BrickMeshes";
import { makeHoloMaterial } from "./BrickModel";

const log = makeLog("SurfaceCalibration");

const WHITE = new vec4(1, 1, 1, 1);
const CLEAR = new vec4(0, 0, 0, 0);
// the brick field that replaces the package's dot lattice (cm, in the hint's plane)
const FIELD_SPACING = 5.0; // columns; rows at half that, staggered (same lattice as the dots)
const FIELD_INNER = 1.3; // the field starts here, in ring radii (the ring interior stays empty)
const BRICK_SCALE = 0.35; // 2x2 DUPLO (3.2 cm) -> ~1.1 cm
const RING_FRACTION = 0.36; // ring radius / quad half-size (measured in the preview)
const DISC_INSET = 0.35; // cm the full disc stays inside the ring
const NORMAL_SIGN = 1; // which side of the quad the bricks stand on
const FINGER_HALF = 0.8; // cm: a tracked fingertip joint sits about this far above the table it rests on

interface FieldBrick { pass: any; r: number; alpha: number }

/**
 * Hand-calibrated table plane (SurfacePlacement NEAR_SURFACE: press a flat hand on the table, ~1 s of
 * stable frames -> pos + rot). Plain class hosted by the controller. The calibration point doubles as the
 * BUILD SPOT. Trimmed from spectacles-lego, incl. the deferred stop (the package fires the callback
 * synchronously mid fade-out; destroying the detector right there crashed on device).
 */
export class SurfaceCalibration {
  private pos: vec3 | null = null;
  private rot: quat | null = null;
  private running = false;
  private timeout: DelayedCallbackEvent | null = null;
  private onDone: ((ok: boolean) => void) | null = null;
  private stopGen = 0;

  // Retheme of the package's hint, all white: ghost hand, white ring, the dot lattice replaced by small
  // ghost bricks standing on the hint plane, and the package's own inner-disc fill (InnerCircleMask, driven
  // while the hand holds still) kept white: the circle starts empty and fills up to place.
  private themePasses: any[] = [];
  private ringRmv: RenderMeshVisual | null = null;
  private fieldHolder: SceneObject | null = null;
  private field: FieldBrick[] = [];
  private disc: SceneObject | null = null;
  private discPass: any = null;
  private discR = 5;
  private discLogged = false;
  private themeTexts: Text[] = [];
  private themeEvent: SceneEvent | null = null;
  private themeStart = 0;
  private fadeStart = -1;

  /** `drop`: cm to lower the package's plane (its hand estimate floats above the table); `fingerHeight`: prefer the lowest tracked fingertip instead. */
  constructor(private host: BaseScriptComponent, private holoMat: Material | null = null, private drop = 1.0, private fingerHeight = false) {}

  /**
   * SurfacePlacement puts the plane at the thumb/index joints minus 1 cm, which lands ~1 cm above the real
   * table (the build area then looks like it floats): lower it by the fixed `drop`. Optionally (fingerHeight,
   * off by default) use the lowest fingertip NEAR the calibration point minus half a finger instead. On device
   * (2026-10-16) the unfiltered version picked up the other hand hanging 15-25 cm lower and sank the area.
   */
  private tableHeight(pos: vec3): number {
    const packageY = pos.y;
    const fixed = packageY - this.drop;
    let lowest: number | null = null;
    if (this.fingerHeight) {
      try {
        const input: any = SIK.HandInputData;
        for (const side of ["left", "right"]) {
          const h: any = input.getHand(side);
          if (!h || !h.isTracked()) continue;
          for (const j of ["indexTip", "middleTip", "ringTip", "pinkyTip"]) {
            const pt = h[j] && h[j].position;
            if (!pt) continue;
            const dx = pt.x - pos.x, dz = pt.z - pos.z;
            if (dx * dx + dz * dz > 15 * 15) continue; // not the hand on the table
            if (pt.y < packageY - 3 || pt.y > packageY + 2) continue; // not resting on this surface
            if (lowest === null || pt.y < lowest) lowest = pt.y;
          }
        }
      } catch (e) { log.w("fingertips: " + e); }
    }
    if (lowest === null) { log.i("table height: package " + packageY.toFixed(1) + " -> " + fixed.toFixed(1) + " (fixed drop " + this.drop + ")"); return fixed; }
    const est = Math.max(packageY - 2, Math.min(packageY, lowest - FINGER_HALF));
    log.i("table height: package " + packageY.toFixed(1) + ", lowest nearby fingertip " + lowest.toFixed(1) + " -> " + est.toFixed(1));
    return est;
  }

  private retheme() {
    if (!this.holoMat) return;
    const ctrl: any = SurfacePlacementController.getInstance();
    const root: SceneObject | null = ctrl && ctrl.sceneObject ? ctrl.sceneObject : null;
    if (!root) { log.w("retheme: no hint root"); return; }
    this.dropTheme();
    let hands = 0, rings = 0;
    const walk = (o: SceneObject) => {
      const rmvs = o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[];
      for (const r of rmvs) {
        const m = r.mainMaterial;
        if (!m) continue;
        const n = m.name || "";
        if (n.indexOf("HandHints") >= 0) {
          const { mat } = makeHoloMaterial(this.holoMat as Material, WHITE, WHITE, 1, 0.9);
          r.mainMaterial = mat;
          // Written AFTER binding: 5.15 drops state set on an unbound clone for some meshes (the first attempt, set
          // before binding, changed nothing on device). The two skinned hand meshes (left/right) lie on the hint
          // plane with the package's depth-writing grid quad: no depth write, no depth test, or they speckle.
          try {
            const p: any = r.mainPass;
            p.depthWrite = false; p.depthTest = false; p.twoSided = true;
            p["baseColor"] = WHITE; p["rimColor"] = WHITE; p["ghost"] = 1; p["pulse"] = 0.15; p["reveal"] = 1; p["alphaMul"] = 0.9;
            log.i("hand hint " + o.name + ": depthWrite=" + p.depthWrite + " depthTest=" + p.depthTest + " twoSided=" + p.twoSided);
          } catch (e) { log.w("hand pass: " + e); }
          try { r.renderOrder = 20; } catch (e) {} // after the grid, the disc and the brick field: the hand reads on top
          hands++;
        } else if (n.indexOf("CircleGrid") >= 0 || n.indexOf("SurfaceGrid") >= 0 || n === "Dots") {
          this.themePasses.push(r.mainPass);
          if (n.indexOf("CircleGrid") >= 0 && !this.ringRmv) this.ringRmv = r;
          rings++;
        }
      }
      const texts = o.getComponents("Component.Text") as Text[];
      for (const t of texts) { try { t.textFill.color = WHITE; this.themeTexts.push(t); } catch (e) {} }
      for (let i = 0; i < o.getChildrenCount(); i++) walk(o.getChild(i));
    };
    walk(root);
    if (this.ringRmv) { try { this.buildField(this.ringRmv); } catch (e) { log.e("brick field: " + e); } }
    this.themeStart = getTime();
    if (!this.themeEvent) {
      // LATE update: the package's TableTop/CircleAnimation rewrite the colours in their own update
      this.themeEvent = this.host.createEvent("LateUpdateEvent");
      this.themeEvent.bind(() => this.tickTheme());
    }
    this.themeEvent.enabled = true;
    log.i("retheme: hands=" + hands + " ring passes=" + rings + " bricks=" + this.field.length);
  }

  /** Small ghost bricks on the package's dot lattice, parented to the ring quad so they follow and scale with the hint. */
  private buildField(rmv: RenderMeshVisual) {
    const so = rmv.getSceneObject();
    const mesh = rmv.mesh;
    if (!mesh) return;
    const mn = mesh.aabbMin, mx = mesh.aabbMax;
    const ext = [mx.x - mn.x, mx.y - mn.y, mx.z - mn.z];
    let thin = 0;
    for (let i = 1; i < 3; i++) if (ext[i] < ext[thin]) thin = i;
    let halfU = 0;
    for (let i = 0; i < 3; i++) if (i !== thin) halfU = Math.max(halfU, ext[i] / 2);
    const unit = so.getTransform().getLocalScale().x || 1; // quad local units -> cm (the quad object is scaled)
    const half = halfU * unit;
    const ringR = half * RING_FRACTION;
    const holder = global.scene.createSceneObject("HintBricks");
    holder.setParent(so);
    const htf = holder.getTransform();
    htf.setLocalPosition(vec3.zero());
    htf.setLocalScale(new vec3(1 / unit, 1 / unit, 1 / unit));
    // the bricks stand on the quad: their +y is the quad's thin (normal) axis
    const a = (Math.PI / 2) * NORMAL_SIGN;
    htf.setLocalRotation(thin === 2 ? quat.angleAxis(a, vec3.right()) : thin === 0 ? quat.angleAxis(-a, vec3.forward()) : (NORMAL_SIGN > 0 ? quat.quatIdentity() : quat.angleAxis(Math.PI, vec3.right())));
    // the fill: a white disc on the quad that grows from the centre to the ring as the hand holds still
    this.discR = ringR - DISC_INSET;
    const disc = global.scene.createSceneObject("HintFill");
    disc.setParent(holder);
    disc.getTransform().setLocalPosition(new vec3(0, 0.05, 0)); // a hair in front of the quad
    disc.getTransform().setLocalScale(new vec3(0.001, 1, 0.001));
    const drmv = disc.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const dm = getDiscMesh();
    if (dm) drmv.mesh = dm;
    const dmat = makeHoloMaterial(this.holoMat as Material, WHITE, WHITE, 0, 0.92);
    try { dmat.pass.depthWrite = false; } catch (e) {} // never hides the hint text
    drmv.mainMaterial = dmat.mat;
    this.disc = disc;
    this.discPass = dmat.pass;
    const rMin = ringR * FIELD_INNER, rMax = half * 0.97;
    const rowPitch = FIELD_SPACING / 2;
    const rows = Math.ceil(rMax / rowPitch), cols = Math.ceil(rMax / FIELD_SPACING) + 1;
    for (let j = -rows; j <= rows; j++) {
      const z = j * rowPitch;
      const off = (j & 1) ? FIELD_SPACING / 2 : 0;
      for (let i = -cols; i <= cols; i++) {
        const x = i * FIELD_SPACING + off;
        const r = Math.sqrt(x * x + z * z);
        if (r < rMin || r > rMax) continue;
        const k = (r - rMin) / (rMax - rMin);
        const alpha = 0.85 * (1 - k * k);
        const obj = global.scene.createSceneObject("HintBrick");
        obj.setParent(holder);
        const tf = obj.getTransform();
        tf.setLocalPosition(new vec3(x, 0, z));
        const long = ((i + j) & 1) === 0;
        const yaw = (long ? Math.PI / 2 : 0) + (((i * 7 + j * 13) % 5) - 2) * 0.05;
        tf.setLocalRotation(quat.angleAxis(yaw, vec3.up()));
        tf.setLocalScale(new vec3(BRICK_SCALE, BRICK_SCALE, BRICK_SCALE));
        const brick = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        const m = getBrickMesh(2, long ? 4 : 2, 1.92, true);
        if (m) brick.mesh = m;
        const { mat, pass } = makeHoloMaterial(this.holoMat as Material, WHITE, WHITE, 1, alpha);
        brick.mainMaterial = mat;
        this.field.push({ pass, r, alpha });
      }
    }
    this.fieldHolder = holder;
    log.i("brick field: " + this.field.length + " bricks, quad half=" + half.toFixed(1) + "cm ring~" + ringR.toFixed(1) + "cm (thin axis " + thin + ", unit " + unit.toFixed(3) + ")");
  }

  private tickTheme() {
    const now = getTime();
    if (this.fadeStart >= 0) {
      // the hint is going away: fade the bricks with it
      const k = (now - this.fadeStart) / 0.6;
      if (k >= 1 || !this.fieldHolder || isNull(this.fieldHolder)) { this.dropTheme(); return; }
      for (const b of this.field) { try { b.pass["alphaMul"] = b.alpha * (1 - k); } catch (e) {} }
      if (this.discPass) { try { this.discPass["alphaMul"] = 0.92 * (1 - k); } catch (e) {} }
      return;
    }
    if (!this.running) { this.endTheme(); return; }
    let fill = 0, scanning = false;
    const ringPass: any = this.ringRmv && !isNull(this.ringRmv) ? this.ringRmv.mainPass : null;
    if (ringPass) {
      // TableTop writes its progress (stable frames / 60) into InnerCircleMask, which eats the ring away
      // clockwise; read it, then keep the ring whole: the progress shows as the disc filling up instead
      try { fill = Number(ringPass.InnerCircleMask) || 0; scanning = !!ringPass.AnimationSwitch; ringPass.InnerCircleMask = 0; } catch (e) {}
      if (global.deviceInfoSystem.isEditor()) {
        // no hands in the editor: demo the fill (empty 2 s, fills slowly over 12 s, full 3 s)
        const t = (now - this.themeStart) % 17;
        fill = t < 2 ? 0 : Math.min(1, (t - 2) / 12);
      }
    }
    scanning = scanning || (fill > 0 && fill < 1);
    if (this.disc && !isNull(this.disc)) {
      const r = this.discR * Math.sqrt(fill); // area grows linearly with the progress
      this.disc.enabled = fill > 0.005;
      this.disc.getTransform().setLocalScale(new vec3(Math.max(0.001, r), 1, Math.max(0.001, r)));
      try { this.discPass["pulse"] = 0.55 + 0.1 * Math.sin(now * 4); } catch (e) {} // emissive: reads as white, not grey
      if (fill > 0.5 && !this.discLogged) { this.discLogged = true; log.i("fill disc r=" + r.toFixed(2) + " at " + this.disc.getTransform().getWorldPosition() + " enabled=" + this.disc.isEnabledInHierarchy); }
    }
    // the words give way to the fill
    const ta = Math.max(0, 1 - fill * 1.3);
    for (const t of this.themeTexts) { try { if (!isNull(t)) t.textFill.color = new vec4(1, 1, 1, ta); } catch (e) {} }
    for (const p of this.themePasses) {
      try {
        if (p.circleColor !== undefined) p.circleColor = WHITE;
        if (p.whiteColor !== undefined) p.whiteColor = WHITE; // the ring + the fill disc
        if (p.dotsColor !== undefined) p.dotsColor = CLEAR; // the dots are bricks now
        if (p.WhiteColor !== undefined) p.WhiteColor = WHITE;
        if (p.YellowColor !== undefined) p.YellowColor = WHITE;
      } catch (e) {}
    }
    for (const b of this.field) {
      // a ripple runs outward while the package scans (hand tracked), the field brightens as the disc fills
      const ripple = scanning ? 0.45 * Math.max(0, Math.sin(now * 3 - b.r * 0.5)) : 0;
      try { b.pass["pulse"] = 0.12 + ripple; b.pass["alphaMul"] = b.alpha * (0.6 + 0.4 * fill); } catch (e) {}
    }
  }

  private endTheme() {
    if (this.fadeStart < 0) this.fadeStart = getTime();
    this.themePasses = [];
    this.ringRmv = null;
  }

  private dropTheme() {
    if (this.themeEvent) this.themeEvent.enabled = false;
    if (this.fieldHolder) { try { if (!isNull(this.fieldHolder)) this.fieldHolder.destroy(); } catch (e) {} }
    this.fieldHolder = null;
    this.field = [];
    this.disc = null;
    this.discPass = null;
    this.discLogged = false;
    this.themeTexts = [];
    this.themePasses = [];
    this.ringRmv = null;
    this.fadeStart = -1;
  }

  isCalibrated(): boolean { return this.pos !== null; }
  isRunning(): boolean { return this.running; }
  getSurfaceY(): number | null { return this.pos ? this.pos.y : null; }
  getPlane(): { pos: vec3; rot: quat } | null {
    return this.pos && this.rot ? { pos: this.pos, rot: this.rot } : null;
  }

  /** Editor / simulation: plant the plane without a hand. */
  setPlane(pos: vec3, rot: quat | null = null) {
    this.pos = pos;
    this.rot = rot || quat.quatIdentity();
    log.i("plane planted at y=" + pos.y.toFixed(1));
  }

  start(timeoutSeconds: number, onDone: (ok: boolean) => void) {
    if (this.running) this.cancel();
    this.running = true;
    this.onDone = onDone;
    log.i("hand calibration started (timeout " + timeoutSeconds + "s)");
    SurfacePlacementController.getInstance().startSurfacePlacement(
      new PlacementSettings(PlacementMode.NEAR_SURFACE, false),
      (pos: vec3, rot: quat) => this.complete(pos, rot),
    );
    if (this.timeout === null) {
      this.timeout = this.host.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      this.timeout.bind(() => this.onTimeout());
    }
    this.timeout.reset(timeoutSeconds);
    // the prefabs are instantiated synchronously, but the hand hints come up a moment later: theme at 0.3 s
    const ev = this.host.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    ev.bind(() => { if (this.running) { try { this.retheme(); } catch (e) { log.e("retheme failed: " + e); } } });
    ev.reset(0.3);
  }

  /** Replace the package's "Place hand face down on a surface" with our own words (set twice: the package writes its text on start). */
  setHintText(text: string) {
    const apply = () => {
      try {
        const ctrl: any = SurfacePlacementController.getInstance();
        const det = ctrl && ctrl.currDetector;
        const t: any = det && det.instructTextObj ? det.instructTextObj.getComponent("Component.Text") : null;
        if (t) t.text = text;
        else log.w("hint text not found");
      } catch (e) { log.w("hint text: " + e); }
    };
    for (const d of [0.05, 0.4]) {
      const ev = this.host.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      ev.bind(() => { if (this.running) apply(); });
      ev.reset(d);
    }
  }

  cancel() {
    if (!this.running) return;
    this.running = false;
    this.endTheme();
    this.onDone = null;
    if (this.timeout) this.timeout.cancel();
    SurfacePlacementController.getInstance().stopSurfacePlacement();
  }

  private complete(pos: vec3, rot: quat) {
    if (this.timeout) this.timeout.cancel();
    this.running = false;
    this.endTheme();
    const gen = ++this.stopGen;
    const stop = this.host.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    stop.bind(() => {
      if (gen === this.stopGen && !this.running) SurfacePlacementController.getInstance().stopSurfacePlacement();
    });
    stop.reset(0.7);
    this.pos = new vec3(pos.x, this.tableHeight(pos), pos.z);
    this.rot = rot;
    log.i("calibrated: y=" + this.pos.y.toFixed(1) + " at (" + pos.x.toFixed(0) + ", " + pos.z.toFixed(0) + ")");
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb(true);
  }

  private onTimeout() {
    if (!this.running) return;
    log.i("calibration timed out");
    this.running = false;
    this.endTheme();
    SurfacePlacementController.getInstance().stopSurfacePlacement();
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb(false);
  }
}
