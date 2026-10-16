import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";
import { getBrickMesh, getButtonCapMesh, getRoundPlateMesh } from "./BrickMeshes";
import { makeHoloMaterial } from "./BrickModel";
import { makeLog } from "./Log";
import { STUD_CM } from "./BrickTypes";

const log = makeLog("BrickButton");

const PRESS_DUR = 0.5; // cap snaps down, then springs back with a little overshoot
const DISMISS_DUR = 0.22;
const BASE_H = 0.5; // the tan bottom plate
const PLATE_H = 0.6; // the grey round plate on top of the box (taller than the studs around it)
const CAP_H = 0.55;
const CAP_HOVER = 0.3; // the cap rises this much when hovered
const CAP_DOWN = -0.3; // ... and sinks this far into the plate when pressed
const WHITE = new vec4(0.96, 0.95, 0.92, 1);
const TAN = new vec4(0.78, 0.68, 0.48, 1);
const GREY = new vec4(0.55, 0.57, 0.6, 1);
const RED = new vec4(0.85, 0.08, 0.1, 1);
const INK = new vec4(0.15, 0.15, 0.2, 1);
// touch press (table buttons): the index finger pushes the cap down like a real button
const FINGER_PAD = 0.7; // the tracked index tip sits about this far above the finger's underside
const TOUCH_MARGIN = 2.0; // cm around the round plate that still counts as "on the button" (most of the box top)
const TOUCH_ABOVE = 8; // a finger hovering up to this far above the cap arms the press
const PRESS_DEPTH = 0.1; // the finger must push the cap down at least this far ...
const PRESS_HOLD = 0.12; // ... for this long (grace: brushing past the button does not count) ...
const PRESS_COOLDOWN = 1.0; // ... and the button ignores further presses for this long after firing

export interface ButtonStyle {
  color?: vec4; // the cap (default red)
  studsX?: number; // box footprint in studs
  studsZ?: number;
  height?: number; // box height, cm
  /** radians the button leans back from "flat on the ground" toward "facing +z" (0 = flat, pi/2 = upright) */
  tilt?: number;
  textScale?: number;
  /** also fire when an index finger pushes the cap down (armed from above, held PRESS_HOLD, PRESS_COOLDOWN) */
  touch?: boolean;
}

/**
 * A pinchable button built the way LEGO fans build buttons: a white brick box (studded top) on a tan base
 * plate, a grey round studded plate sitting in a clear patch in the middle of the studs and a round coloured
 * cap on it that is the actual button. The label is
 * printed on the box's FRONT face (the one toward the user). The cap bobs very slightly, rises when hovered,
 * snaps down into the plate when pressed and springs back. SIK Interactable (near poke or far pinch) + a
 * box collider, created at runtime the way spectacles-lego PropLoader does it. With `touch` the button also
 * works like a real one: an index finger coming down from above onto the round plate pushes the cap along
 * with it and fires once it has been held PRESS_DEPTH deep for PRESS_HOLD; it must lift off (back to cap
 * level) before it can fire again, and a finger entering from the side already deep never fires. Parent it to the
 * head-locked HUD or to a world-locked object (the build area). Pivot = the box's front bottom edge.
 * dismiss() shrinks the whole button away.
 */
export class BrickButton {
  readonly obj: SceneObject;
  private capPass: any = null;
  private boxPass: any = null;
  private capTf: Transform;
  private capY: number;
  private depth: number;
  private phase = Math.random() * 6.28;
  private text: Text;
  private hover = false;
  private pressedAt = -1;
  private dismissAt = -1;
  private visible = false;
  private base: vec3;
  private tilt: number;
  private label: string;
  private touch: boolean;
  private plateR: number;
  private touchArmed = false; // a finger was seen above the cap (presses come from above, not from the side)
  private touchDownSince = -1;
  private touchDepth = 0; // > 0 while a finger pushes the cap down (cm)
  private touchNear = false;
  private lastFireAt = -10;
  private static hands: any[] | null = null;
  /** Editor/testing: fake index-tip world positions used instead of the tracked hands. */
  static debugTips: vec3[] | null = null;

  constructor(parent: SceneObject | null, holoMat: Material, label: string, private onPress: () => void, localPos: vec3, style: ButtonStyle = {}) {
    this.label = label;
    this.touch = !!style.touch;
    const sx = style.studsX || 6, sz = style.studsZ || 4;
    const h = style.height || 2.4;
    this.tilt = style.tilt !== undefined ? style.tilt : 0;
    this.base = localPos;
    this.obj = global.scene.createSceneObject("BrickButton_" + label);
    if (parent) this.obj.setParent(parent);
    this.obj.getTransform().setLocalPosition(localPos);
    this.obj.getTransform().setLocalRotation(quat.angleAxis(this.tilt, vec3.right()));

    // pivot = the box's front bottom edge; the box extends back (local -z)
    const depth = sz * STUD_CM, width = sx * STUD_CM;
    this.depth = depth;
    const cx = 0, cz = -depth / 2;
    const part = (name: string, mesh: RenderMesh | null, y: number, color: vec4, rim: vec4, scale = 1) => {
      const o = global.scene.createSceneObject(name);
      o.setParent(this.obj);
      o.getTransform().setLocalPosition(new vec3(cx, y, cz));
      if (scale !== 1) o.getTransform().setLocalScale(new vec3(scale, scale, scale));
      const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      if (mesh) rmv.mesh = mesh;
      const m = makeHoloMaterial(holoMat, color, rim, 0, 1); // solid plastic
      rmv.mainMaterial = m.mat;
      return { o, pass: m.pass };
    };
    part("Base", getBrickMesh(sx, sz, BASE_H, false), 0, TAN, new vec4(1, 1, 1, 1));
    const r = Math.min(width, depth) * 0.28;
    this.plateR = r;
    const box = part("Box", getBrickMesh(sx, sz, h, true, r), BASE_H, WHITE, new vec4(1, 1, 1, 1)); // studs all over the top, none under the plate
    this.boxPass = box.pass;
    part("Plate", getRoundPlateMesh(r, PLATE_H, 8), BASE_H + h, GREY, new vec4(1, 1, 1, 1));
    this.capY = BASE_H + h + PLATE_H;
    const cap = part("Cap", getButtonCapMesh(r * 0.6, CAP_H), this.capY, style.color || RED, new vec4(1, 0.9, 0.8, 1));
    this.capTf = cap.o.getTransform();
    this.capPass = cap.pass;

    // label printed on the box's front face (faces +z = the user); Text faces +z by default
    const textObj = global.scene.createSceneObject("Label");
    textObj.setParent(this.obj);
    textObj.getTransform().setLocalPosition(new vec3(0, BASE_H + h * 0.5, 0.08));
    this.text = textObj.createComponent("Component.Text") as Text;
    this.text.text = label;
    this.text.size = 40;
    this.text.horizontalAlignment = HorizontalAlignment.Center;
    this.text.verticalAlignment = VerticalAlignment.Center;
    this.text.textFill.color = INK;
    const ts = style.textScale || 0.5;
    textObj.getTransform().setLocalScale(new vec3(ts, ts, ts));

    try {
      const collider: any = this.obj.createComponent("Physics.ColliderComponent");
      collider.fitVisual = false;
      const shape = Shape.createBoxShape();
      const top = this.capY + CAP_H + CAP_HOVER + 0.5;
      shape.size = new vec3(width + 0.6, top, depth + 0.6);
      collider.shape = shape;
      try { collider.getTransform().setLocalPosition(new vec3(0, top / 2, cz)); } catch (e) {}
    } catch (e) { log.e("collider: " + e); }
    try {
      const interactable: any = this.obj.createComponent(Interactable.getTypeName());
      interactable.onHoverEnter.add(() => { this.hover = true; });
      interactable.onHoverExit.add(() => { this.hover = false; });
      interactable.onTriggerEnd.add(() => this.press("pinch"));
    } catch (e) { log.e("interactable: " + e); }

    this.setVisible(false);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.obj.enabled = v;
    this.pressedAt = -1;
    this.dismissAt = -1;
    this.touchArmed = false;
    this.touchDownSince = -1;
    this.touchDepth = 0;
    this.touchNear = false;
    this.obj.getTransform().setLocalPosition(this.base);
    this.obj.getTransform().setLocalScale(new vec3(1, 1, 1));
  }

  /** Shrink away (after the press, or straight away). */
  dismiss() {
    if (!this.visible || this.dismissAt >= 0) return;
    this.dismissAt = getTime() + (this.pressedAt >= 0 ? Math.max(0, PRESS_DUR - (getTime() - this.pressedAt)) : 0);
  }

  isVisible(): boolean { return this.visible; }
  setLabel(label: string) { this.text.text = label; }

  /** Editor sim: world position of a fake fingertip whose underside sits `dy` above the cap top (negative = pushing it). */
  fakeTip(dy: number): vec3 {
    return this.obj.getTransform().getWorldTransform().multiplyPoint(new vec3(0, this.capY + CAP_H + FINGER_PAD + dy, -this.depth / 2));
  }

  private press(source: string) {
    const now = getTime();
    if (!this.visible || this.pressedAt >= 0 || now - this.lastFireAt < PRESS_COOLDOWN) return;
    this.pressedAt = now;
    this.lastFireAt = now;
    log.i("pressed " + this.label + " (" + source + ")");
    try { this.onPress(); } catch (e) { log.e("onPress: " + e); }
  }

  private static tips(): vec3[] {
    if (BrickButton.debugTips) return BrickButton.debugTips;
    if (!BrickButton.hands) {
      try {
        const input: any = SIK.HandInputData;
        BrickButton.hands = [input.getHand("left"), input.getHand("right")];
      } catch (e) { log.w("no hand input: " + e); BrickButton.hands = []; }
    }
    const out: vec3[] = [];
    for (const h of BrickButton.hands) {
      try { if (h && h.isTracked() && h.indexTip) out.push(h.indexTip.position); } catch (e) {}
    }
    return out;
  }

  /** The finger press: the deepest index finger over the round plate drives the cap and, held long enough, fires. */
  private tickTouch(now: number) {
    const tips = BrickButton.tips();
    const capTop = this.capY + CAP_H;
    let depth: number | null = null; // how far the finger's underside is below the cap top (cm, < 0 = above it)
    if (tips.length) {
      const inv = this.obj.getTransform().getInvertedWorldTransform();
      const reach = this.plateR + TOUCH_MARGIN;
      for (const t of tips) {
        const p = inv.multiplyPoint(t);
        const dx = p.x, dz = p.z + this.depth / 2;
        if (dx * dx + dz * dz > reach * reach) continue;
        const d = capTop - (p.y - FINGER_PAD);
        if (d < -TOUCH_ABOVE || d > capTop + 1) continue; // far above, or below the table
        if (depth === null || d > depth) depth = d;
      }
    }
    this.touchNear = depth !== null;
    if (depth === null) { this.touchArmed = false; this.touchDownSince = -1; this.touchDepth = 0; return; }
    this.touchDepth = Math.max(0, depth);
    const holding = this.touchDownSince >= 0;
    const pressing = depth >= (holding ? PRESS_DEPTH - 0.3 : PRESS_DEPTH); // a little hysteresis while held
    if (!pressing) { this.touchArmed = true; this.touchDownSince = -1; return; } // over the button, not pushing: armed
    if (!this.touchArmed) return; // came in already deep (from the side, or still down after firing): ignore
    if (!holding) this.touchDownSince = now;
    else if (now - this.touchDownSince >= PRESS_HOLD) { this.touchArmed = false; this.touchDownSince = -1; this.press("touch"); }
  }

  tick(now: number) {
    if (!this.visible || !this.capPass) return;
    const tf = this.obj.getTransform();
    let flash = 0;
    // the cap: a whisper of a bob, up when hovered, down into the plate when pressed, then a spring back
    if (this.touch) this.tickTouch(now);
    const rest = (this.hover ? CAP_HOVER : 0) + 0.04 * Math.sin(now * 2 + this.phase);
    let lift = rest;
    if (this.touchDepth > 0) lift = Math.max(CAP_DOWN, -this.touchDepth); // the cap goes down with the finger
    if (this.pressedAt >= 0) {
      const k = Math.min(1, (now - this.pressedAt) / PRESS_DUR);
      if (k < 0.2) lift = rest + (CAP_DOWN - rest) * (k / 0.2);
      else { const s = (k - 0.2) / 0.8; lift = CAP_DOWN + (rest - CAP_DOWN) * (1 - Math.exp(-4 * s) * Math.cos(2 * Math.PI * s)); }
      flash = Math.max(0, 1 - k * 2);
      // a non-dismissing press (next/back) settles and is ready again
      if (k >= 1 && this.dismissAt < 0) { this.pressedAt = -1; lift = rest; }
    }
    this.capTf.setLocalPosition(new vec3(0, this.capY + lift, -this.depth / 2));
    if (this.dismissAt >= 0 && now >= this.dismissAt) {
      const k = Math.min(1, (now - this.dismissAt) / DISMISS_DUR);
      const s = 1 - k * k;
      tf.setLocalScale(new vec3(s, s, s));
      if (k >= 1) { this.setVisible(false); return; }
    }
    const idle = 0.05 + 0.05 * Math.sin(now * 3 + this.phase);
    try { this.capPass["pulse"] = (this.hover || this.touchNear ? 0.35 : idle) + flash; } catch (e) {}
    try { this.boxPass["pulse"] = flash * 0.25; } catch (e) {}
  }
}
