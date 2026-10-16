import { getBrickMesh, getButtonCapMesh, getLensMesh, STUD_H } from "./BrickMeshes";
import { makeHoloMaterial } from "./BrickModel";
import { STUD_CM } from "./BrickTypes";

const WHITE = new vec4(0.96, 0.95, 0.92, 1);
const RING = new vec4(0.72, 0.74, 0.78, 1);
const GLASS = new vec4(0.2, 0.45, 0.9, 1);
const RED = new vec4(0.85, 0.08, 0.1, 1);
const YELLOW = new vec4(1.0, 0.85, 0.2, 1);
const RIM = new vec4(1, 1, 1, 1);
const BODY_H = 2.2;

/**
 * A little brick-built camera: a white 4x2 brick body, a round lens toward the user (+z), a red shutter cap on
 * the front-right stud and a yellow flash block on the front-left one. It hovers (bob + slow sway) over the
 * TAKE PHOTO button so the state reads at a glance; flash() pops it (countdown ticks, the shot itself).
 * Pivot = the body's centre.
 */
export class BrickCamera {
  readonly obj: SceneObject;
  private tf: Transform;
  private glassPass: any = null;
  private flashPass: any = null;
  private base: vec3;
  private visible = false;
  private flashAt = -1;
  private flashBig = false;

  /** `size`: overall scale of the camera (1 = a 4x2 DUPLO brick body). */
  constructor(parent: SceneObject | null, holoMat: Material, localPos: vec3, private size: number = 1) {
    this.obj = global.scene.createSceneObject("BrickCamera");
    if (parent) this.obj.setParent(parent);
    this.base = localPos;
    this.tf = this.obj.getTransform();
    this.tf.setLocalPosition(localPos);
    const part = (name: string, mesh: RenderMesh | null, pos: vec3, color: vec4) => {
      const o = global.scene.createSceneObject(name);
      o.setParent(this.obj);
      o.getTransform().setLocalPosition(pos);
      const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      if (mesh) rmv.mesh = mesh;
      const m = makeHoloMaterial(holoMat, color, RIM, 0, 1);
      rmv.mainMaterial = m.mat;
      return m.pass;
    };
    const w = 4 * STUD_CM, d = 2 * STUD_CM;
    part("Body", getBrickMesh(4, 2, BODY_H, true), new vec3(0, -BODY_H / 2, 0), WHITE);
    part("LensRing", getLensMesh(1.2, 0.7), new vec3(0, 0, d / 2 - 0.05), RING);
    this.glassPass = part("LensGlass", getLensMesh(0.85, 1.0), new vec3(0, 0, d / 2 - 0.05), GLASS);
    const studTop = BODY_H / 2 + STUD_H - 0.03;
    part("Shutter", getButtonCapMesh(0.45, 0.45), new vec3(w / 2 - STUD_CM / 2, studTop, d / 2 - STUD_CM / 2), RED);
    this.flashPass = part("Flash", getBrickMesh(1, 1, 0.7, false), new vec3(-w / 2 + STUD_CM / 2, studTop, d / 2 - STUD_CM / 2), YELLOW);
    this.setVisible(false);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.obj.enabled = v;
    this.flashAt = -1;
    this.tf.setLocalScale(new vec3(this.size, this.size, this.size));
  }

  isVisible(): boolean { return this.visible; }

  /** Pop + lens/flash glow: small on each countdown tick, big for the shot itself. */
  flash(big: boolean = false) {
    this.flashAt = getTime();
    this.flashBig = big;
  }

  tick(now: number) {
    if (!this.visible) return;
    const bob = 0.4 * Math.sin(now * 1.6);
    this.tf.setLocalPosition(new vec3(this.base.x, this.base.y + bob, this.base.z));
    this.tf.setLocalRotation(quat.angleAxis(0.12 * Math.sin(now * 0.7), vec3.up()));
    let k = 0;
    if (this.flashAt >= 0) {
      k = Math.max(0, 1 - (now - this.flashAt) / (this.flashBig ? 0.5 : 0.3));
      const s = this.size * (1 + (this.flashBig ? 0.25 : 0.1) * Math.sin(k * Math.PI));
      this.tf.setLocalScale(new vec3(s, s, s));
    }
    const idle = 0.08 + 0.06 * Math.sin(now * 2.5);
    try { this.glassPass["pulse"] = idle + k * 0.9; } catch (e) {}
    try { this.flashPass["pulse"] = 0.1 + k * 1.2; } catch (e) {}
  }
}
