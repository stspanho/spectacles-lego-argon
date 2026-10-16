import { BrickButton } from "./BrickButton";
import { getBarMesh, getBrickMesh } from "./BrickMeshes";
import { makeHoloMaterial } from "./BrickModel";
import { makeLog } from "./Log";

const log = makeLog("BuildArea");

const MARGIN = 4; // cm around the model footprint
const BAR_W = 1.2;
const BAR_H = 0.5;
const GLOW = new vec4(0.35, 0.85, 1.0, 1);
const GLOW_RIM = new vec4(1, 1, 1, 1);
const SIGN_TILT = 0; // flat on the table: a leaning sign got between the user and the build
const SIGN_TEXT_Z = -4; // sign-local: the text block's centre (-z = toward the area)
const SIGN_STUDS_Z = -10.2; // the step row lies between the area's front border and the text
const SIGN_TEXT_SCALE = 1.0; // ~2.3 cm lines (was 0.4: unreadable on device)
const SIGN_WRAP = 44; // ~19 cm lines at this scale
const SIGN_LINES = 4;
const STUD_ON = new vec4(1.0, 0.8, 0.0, 1);
const STUD_OFF = new vec4(0.75, 0.78, 0.85, 1); // light: dark studs vanish on the additive Specs display

/**
 * The world-locked build area on the table: a glowing border around the model footprint (four bars, a
 * glow chasing around the perimeter, corner studs), then flat on the table in front of it: the step row
 * (mini bricks + counter), the instruction text, and the START / BACK / NEXT brick buttons. Nothing stands up
 * between the user and the build. Local frame: origin = build spot on the table, +z = toward the user at placement.
 */
export class BuildArea {
  readonly root: SceneObject;
  private bars: { obj: SceneObject; pass: any }[] = [];
  private corners: { obj: SceneObject; pass: any }[] = [];
  private sign: SceneObject | null = null;
  private signPass: any = null;
  private signText: Text | null = null;
  private counter: Text | null = null;
  private studs: { obj: SceneObject; pass: any }[] = [];
  private studTotal = -1;
  private step = 0;
  private startBtn: BrickButton;
  private nextBtn: BrickButton;
  private backBtn: BrickButton;
  private placedAt = 0;
  private fadeStart = -1; // finale: when the fade-out begins (getTime), -1 = not fading
  private fadeDur = 1.5;
  private lx = 20;
  private lz = 12;
  private signW = 26;

  constructor(private holoMat: Material, onStart: () => void, onNext: () => void, onBack: () => void) {
    this.root = global.scene.createSceneObject("BuildArea");
    this.root.enabled = false;
    this.startBtn = new BrickButton(this.root, holoMat, "START", onStart, new vec3(0, 0, 0), { studsX: 6, studsZ: 4, tilt: 0, touch: true, color: new vec4(0.16, 0.65, 0.27, 1) });
    this.nextBtn = new BrickButton(this.root, holoMat, "NEXT", onNext, new vec3(0, 0, 0), { studsX: 5, studsZ: 3, tilt: 0, touch: true, color: new vec4(0.0, 0.42, 0.83, 1) });
    this.backBtn = new BrickButton(this.root, holoMat, "BACK", onBack, new vec3(0, 0, 0), { studsX: 5, studsZ: 3, tilt: 0, touch: true, color: new vec4(0.45, 0.45, 0.5, 1) });
  }

  /** Put the area at `pos` on the table, +z toward `towards` (the user), sized to the footprint. */
  place(pos: vec3, towards: vec3, footprintX: number, footprintZ: number) {
    const dir = new vec3(towards.x - pos.x, 0, towards.z - pos.z);
    const yaw = dir.length > 1e-3 ? Math.atan2(dir.x, dir.z) : 0;
    const tf = this.root.getTransform();
    tf.setWorldPosition(pos);
    tf.setWorldRotation(quat.angleAxis(yaw, vec3.up()));
    this.lx = footprintX + 2 * MARGIN;
    this.lz = footprintZ + 2 * MARGIN;
    this.signW = Math.max(this.lx, 24);
    this.buildFrame();
    this.buildSign();
    const front = this.lz / 2 + 23;
    this.moveButton(this.startBtn, new vec3(0, 0, front));
    this.moveButton(this.nextBtn, new vec3(this.signW / 4 + 3, 0, front));
    this.moveButton(this.backBtn, new vec3(-this.signW / 4 - 3, 0, front));
    this.placedAt = getTime();
    this.fadeStart = -1;
    this.root.enabled = true;
    log.i("placed " + this.lx.toFixed(0) + "x" + this.lz.toFixed(0) + " cm, yaw " + (yaw * 57.3).toFixed(0));
  }

  rotation(): quat { return this.root.getTransform().getWorldRotation(); }

  private moveButton(b: BrickButton, p: vec3) {
    (b as any).base = p;
    b.obj.getTransform().setLocalPosition(p);
  }

  private buildFrame() {
    for (const b of this.bars) { try { b.obj.destroy(); } catch (e) {} }
    for (const c of this.corners) { try { c.obj.destroy(); } catch (e) {} }
    this.bars = [];
    this.corners = [];
    const hx = this.lx / 2, hz = this.lz / 2;
    const specs: { pos: vec3; sx: number; sz: number }[] = [
      { pos: new vec3(0, 0, -hz), sx: this.lx, sz: BAR_W },
      { pos: new vec3(hx, 0, 0), sx: BAR_W, sz: this.lz },
      { pos: new vec3(0, 0, hz), sx: this.lx, sz: BAR_W },
      { pos: new vec3(-hx, 0, 0), sx: BAR_W, sz: this.lz },
    ];
    for (const s of specs) {
      const obj = global.scene.createSceneObject("Bar");
      obj.setParent(this.root);
      obj.getTransform().setLocalPosition(s.pos);
      const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      const mesh = getBarMesh(s.sx, BAR_H, s.sz);
      if (mesh) rmv.mesh = mesh;
      const { mat, pass } = makeHoloMaterial(this.holoMat, GLOW, GLOW_RIM, 1, 0.8);
      rmv.mainMaterial = mat;
      try { rmv.renderOrder = 4; } catch (e) {}
      this.bars.push({ obj, pass });
    }
    for (const [cx, cz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
      const obj = global.scene.createSceneObject("Corner");
      obj.setParent(this.root);
      obj.getTransform().setLocalPosition(new vec3(cx, 0, cz));
      const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      const mesh = getBrickMesh(1, 1, 0.9, true);
      if (mesh) rmv.mesh = mesh;
      const { mat, pass } = makeHoloMaterial(this.holoMat, GLOW, GLOW_RIM, 1, 0.9);
      rmv.mainMaterial = mat;
      try { rmv.renderOrder = 4; } catch (e) {}
      this.corners.push({ obj, pass });
    }
  }

  private buildSign() {
    if (this.sign) { try { this.sign.destroy(); } catch (e) {} }
    this.studs = [];
    this.studTotal = -1;
    this.sign = global.scene.createSceneObject("Sign");
    this.sign.setParent(this.root);
    this.sign.getTransform().setLocalPosition(new vec3(0, 0, this.lz / 2 + 13));
    this.sign.getTransform().setLocalRotation(quat.angleAxis(SIGN_TILT, vec3.right()));
    // the pivot is the sign's front edge (toward the user) on the table; the sign extends back (local -z) toward
    // the area. No panel behind the words: just the text, the stud row beyond it and the counter.
    this.signPass = null;

    const textObj = global.scene.createSceneObject("Instruction");
    textObj.setParent(this.sign);
    textObj.getTransform().setLocalPosition(new vec3(0, 0.3, SIGN_TEXT_Z));
    textObj.getTransform().setLocalRotation(quat.angleAxis(-Math.PI / 2, vec3.right()));
    textObj.getTransform().setLocalScale(new vec3(SIGN_TEXT_SCALE, SIGN_TEXT_SCALE, SIGN_TEXT_SCALE));
    this.signText = textObj.createComponent("Component.Text") as Text;
    this.signText.text = "";
    this.signText.size = 36;
    this.signText.horizontalAlignment = HorizontalAlignment.Center;
    this.signText.verticalAlignment = VerticalAlignment.Center;
    this.signText.textFill.color = new vec4(1, 1, 1, 1);

    const cObj = global.scene.createSceneObject("Counter");
    cObj.setParent(this.sign);
    cObj.getTransform().setLocalPosition(new vec3(this.signW / 2 - 1, 0.3, SIGN_STUDS_Z)); // moved next to the row in buildStuds()
    cObj.getTransform().setLocalRotation(quat.angleAxis(-Math.PI / 2, vec3.right()));
    cObj.getTransform().setLocalScale(new vec3(0.6, 0.6, 0.6));
    this.counter = cObj.createComponent("Component.Text") as Text;
    this.counter.text = "";
    this.counter.size = 30;
    this.counter.horizontalAlignment = HorizontalAlignment.Center;
    this.counter.verticalAlignment = VerticalAlignment.Center;
    this.counter.textFill.color = new vec4(0.6, 0.9, 1, 1);
    this.sign.enabled = false;
  }

  private buildStuds(total: number) {
    for (const s of this.studs) { try { s.obj.destroy(); } catch (e) {} }
    this.studs = [];
    this.studTotal = total;
    if (!this.sign || total <= 0) return;
    let spacing = Math.min(2.2, (this.signW - 8) / total);
    // the mini brick is 3.2 cm wide at scale 1: shrink it so neighbours keep a gap (11+ steps z-fought on device)
    const scale = Math.max(0.28, Math.min(0.5, (spacing - 0.3) / 3.2));
    spacing = Math.max(spacing, 3.2 * scale + 0.3);
    const x0 = -((total - 1) * spacing) / 2; // centred on the text; the counter sits just right of the row
    if (this.counter) {
      const ctf = this.counter.getSceneObject().getTransform();
      ctf.setLocalPosition(new vec3(-x0 + spacing + 1.2, 0.3, SIGN_STUDS_Z)); // centred text, one gap right of the last puck
    }
    for (let i = 0; i < total; i++) {
      const obj = global.scene.createSceneObject("Stud");
      obj.setParent(this.sign);
      obj.getTransform().setLocalPosition(new vec3(x0 + i * spacing, 0, SIGN_STUDS_Z));
      obj.getTransform().setLocalScale(new vec3(scale, scale, scale));
      const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      const mesh = getBrickMesh(2, 2, 1.92, true); // a mini 2x2 DUPLO brick per step: solid yellow once done, ghost grey until then
      if (mesh) rmv.mesh = mesh;
      const { mat, pass } = makeHoloMaterial(this.holoMat, STUD_OFF, GLOW_RIM, 0, 0.6);
      rmv.mainMaterial = mat;
      this.studs.push({ obj, pass });
    }
  }

  /** Text on the sign; `step` = 0-based current step, `total` = step count (0 = no progress row). */
  setInstruction(text: string, step: number, total: number) {
    if (!this.sign || !this.signText || !this.counter) return;
    this.sign.enabled = true;
    this.signText.text = BuildArea.wrap(text, SIGN_WRAP, SIGN_LINES);
    this.counter.text = total > 0 ? Math.min(step + 1, total) + " / " + total : "";
    if (total !== this.studTotal) this.buildStuds(total);
    this.step = step;
    for (let i = 0; i < this.studs.length; i++) {
      const done = i < step, cur = i === step;
      try {
        this.studs[i].pass["baseColor"] = done || cur ? STUD_ON : STUD_OFF;
        this.studs[i].pass["ghost"] = done || cur ? 0 : 1;
        this.studs[i].pass["alphaMul"] = done || cur ? 1 : 0.5;
        this.studs[i].pass["pulse"] = 0;
      } catch (e) {}
    }
  }

  showInstruction(v: boolean) { if (this.sign) this.sign.enabled = v; }

  static wrap(s: string, width: number, maxLines: number): string {
    const words = (s || "").split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if (line.length + w.length + 1 > width && line.length > 0) { lines.push(line); line = w; }
      else line = line ? line + " " + w : w;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = keep[maxLines - 1].replace(/\s+\S*$/, "") + "..."; return keep.join("\n"); }
    return lines.join("\n");
  }

  showStart(v: boolean) { v ? this.startBtn.setVisible(true) : this.startBtn.dismiss(); }
  showStepButtons(v: boolean) {
    if (v) { this.nextBtn.setVisible(true); this.backBtn.setVisible(true); }
    else { this.nextBtn.dismiss(); this.backBtn.dismiss(); }
  }
  setBackEnabled(on: boolean) { this.backBtn.setLabel(on ? "BACK" : "  "); }
  /** Editor sim: a fake fingertip over the NEXT cap (see BrickButton.fakeTip) while the button is up. */
  nextFakeTip(dy: number): vec3 | null { return this.nextBtn.isVisible() ? this.nextBtn.fakeTip(dy) : null; }

  hide() { this.root.enabled = false; }

  /** Finale: `delay` s from now fade the border, text and step row out over `dur` s, then hide (the real build stays). */
  fadeOut(delay: number, dur: number) {
    this.fadeStart = getTime() + delay;
    this.fadeDur = Math.max(0.1, dur);
  }

  tick(now: number) {
    if (!this.root.enabled) return;
    const t = now - this.placedAt;
    let f = 1; // fade factor
    if (this.fadeStart >= 0 && now >= this.fadeStart) {
      const k = Math.min(1, (now - this.fadeStart) / this.fadeDur);
      f = 1 - k * k;
      if (k >= 1) { this.fadeStart = -1; this.root.enabled = false; return; }
    }
    for (let i = 0; i < this.bars.length; i++) {
      const chase = Math.max(0, Math.sin(t * 2.5 - i * (Math.PI / 2)));
      try { this.bars[i].pass["pulse"] = (0.15 + 0.1 * Math.sin(t * 1.5) + 0.5 * chase * chase) * f; if (f < 1) this.bars[i].pass["alphaMul"] = 0.8 * f; } catch (e) {}
    }
    for (let i = 0; i < this.corners.length; i++) {
      try { this.corners[i].pass["pulse"] = (0.3 + 0.3 * Math.max(0, Math.sin(t * 2.5 - i * (Math.PI / 2) + 0.6))) * f; if (f < 1) this.corners[i].pass["alphaMul"] = 0.9 * f; } catch (e) {}
    }
    if (this.signPass) { try { this.signPass["pulse"] = 0.08 + 0.05 * Math.sin(t * 1.2); } catch (e) {} }
    const cur = this.studs[this.step];
    if (cur) { try { cur.pass["pulse"] = (0.45 + 0.35 * Math.sin(now * 5)) * f; } catch (e) {} }
    if (f < 1) {
      for (const s of this.studs) { try { s.pass["alphaMul"] = f; s.pass["pulse"] = 0; } catch (e) {} }
      try { if (this.signText) this.signText.textFill.color = new vec4(1, 1, 1, f); } catch (e) {}
      try { if (this.counter) this.counter.textFill.color = new vec4(0.6, 0.9, 1, f); } catch (e) {}
    }
    this.startBtn.tick(now);
    this.nextBtn.tick(now);
    this.backBtn.tick(now);
  }
}
