import { makeLog } from "./Log";
import { getShapeMesh } from "./BrickMeshes";
import { Bounds, Design, Inventory, Piece, clamp01, easeOutBounce, hexToColor, layoutPieces, modelBounds, shapeOf } from "./BrickTypes";

const log = makeLog("BrickModel");

// Uniform names = the input names in Assets/Shaders/BrickHolo.glsl.
const U = { base: "baseColor", rim: "rimColor", ghost: "ghost", pulse: "pulse", reveal: "reveal", alpha: "alphaMul" };
const RIM_GHOST = new vec4(0.55, 0.85, 1.0, 1);
const RIM_SPECIAL = new vec4(1.0, 0.9, 0.5, 1);
const DROP_HEIGHT = 12; // cm
const DROP_DUR = 0.9;
const DROP_STAGGER = 0.35;

interface Node {
  piece: Piece;
  obj: SceneObject;
  tf: Transform;
  pass: any;
  base: vec3; // local resting position
  color: vec4;
  dropStart: number;
  delay: number;
  alpha: number;
  ghost: number;
  occ: SceneObject | null; // depth-only copy, on while the piece counts as placed: hides the border / holograms behind the real brick
}

/** Applies BrickHolo render state + default uniforms to a fresh clone. */
export function makeHoloMaterial(src: Material, color: vec4, rim: vec4, ghost: number, alpha: number): { mat: Material; pass: any } {
  const mat = src.clone();
  const pass: any = mat.mainPass;
  try { pass.blendMode = BlendMode.Normal; } catch (e) {}
  // depth write ON even for ghosts: nearer ghost pieces hide farther ones, so the silhouette stays clean
  try { pass.depthWrite = true; pass.depthTest = true; pass.twoSided = false; } catch (e) {}
  try {
    pass[U.base] = color; pass[U.rim] = rim; pass[U.ghost] = ghost; pass[U.pulse] = 0; pass[U.reveal] = 1; pass[U.alpha] = alpha;
  } catch (e) { log.e("uniform init failed: " + e); }
  return { mat, pass };
}

export class BrickModel {
  readonly root: SceneObject;
  private nodes: Node[][] = [];
  public bounds: Bounds = { cx: 0, cz: 0, lx: 8, lz: 8, top: 2 };
  private mode: "hidden" | "preview" | "step" | "done" = "hidden";
  private step = -1;
  private modeStart = 0;
  private fadeStart = -1; // finale fade-out (getTime at which it begins), -1 = none
  private fadeDur = 1.5;
  public placedAlpha = 0.2;

  constructor(private holoMat: Material) {
    this.root = global.scene.createSceneObject("BrickModel");
    this.root.enabled = false;
  }

  build(design: Design, inventory: Inventory) {
    this.clear();
    const placements = layoutPieces(design, inventory);
    this.bounds = modelBounds(placements);
    let n = 0;
    this.nodes = placements.map((pieces) =>
      pieces.map((p, i) => {
        const obj = global.scene.createSceneObject("Piece_" + p.item.id);
        obj.setParent(this.root);
        const tf = obj.getTransform();
        const base = new vec3(p.x - this.bounds.cx, p.y, p.z - this.bounds.cz);
        tf.setLocalPosition(base);
        const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        const mesh = getShapeMesh(shapeOf(p.item), p.sx, p.sz, p.h, true);
        if (mesh) rmv.mesh = mesh;
        const special = p.item.kind === "special";
        const color = hexToColor(p.item.hex);
        const { mat, pass } = makeHoloMaterial(this.holoMat, color, special ? RIM_SPECIAL : RIM_GHOST, 1, 1);
        rmv.mainMaterial = mat;
        // written again AFTER the material is bound (5.15: uniforms set on a fresh clone before binding were lost on some pieces)
        try { pass[U.base] = color; pass[U.rim] = special ? RIM_SPECIAL : RIM_GHOST; } catch (e) {}
        try { rmv.renderOrder = 10; } catch (e) {}
        const occ = this.makeOccluder(obj, mesh);
        obj.enabled = false;
        n++;
        return { piece: p, obj, tf, pass, base, color, dropStart: -1, delay: i * DROP_STAGGER, alpha: 1, ghost: 1, occ };
      }),
    );
    log.i("built " + n + " pieces, " + this.nodes.length + " steps, footprint " + this.bounds.lx.toFixed(1) + "x" + this.bounds.lz.toFixed(1) + " cm, top " + this.bounds.top.toFixed(1));
  }

  /**
   * A depth-only twin of the piece (colour writes masked, drawn before the build area's border): once the real
   * brick is there, whatever the hologram says is behind it (the far border bar, later ghosts) is hidden, as
   * it would be by the real brick. Slightly smaller than the ghost so the two never z-fight.
   */
  private makeOccluder(parent: SceneObject, mesh: RenderMesh | null): SceneObject | null {
    try {
      const o = global.scene.createSceneObject("Occluder");
      o.setParent(parent);
      o.getTransform().setLocalScale(new vec3(0.96, 0.96, 0.96));
      const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      if (mesh) rmv.mesh = mesh;
      rmv.mainMaterial = this.holoMat.clone();
      const pass: any = rmv.mainPass; // state written after binding (5.15 drops it on an unbound clone for some meshes)
      pass.blendMode = BlendMode.Normal;
      pass.depthWrite = true;
      pass.depthTest = true;
      pass.twoSided = false;
      pass.colorMask = new vec4b(false, false, false, false);
      pass[U.base] = new vec4(0, 0, 0, 1); pass[U.ghost] = 0; pass[U.pulse] = 0; pass[U.reveal] = 1; pass[U.alpha] = 1;
      rmv.renderOrder = 2; // before the border bars (4), the pile markers (5) and the pieces (10)
      o.enabled = false;
      if (!this.occLogged) { this.occLogged = true; log.i("occluders on (colorMask " + pass.colorMask + ")"); }
      return o;
    } catch (e) {
      if (!this.occLogged) { this.occLogged = true; log.w("no occluders: " + e); }
      return null;
    }
  }
  private occLogged = false;

  private occlude(n: Node, on: boolean) { if (n.occ && n.occ.enabled !== on) n.occ.enabled = on; }

  stepCount(): number { return this.nodes.length; }
  stepPieces(i: number): Piece[] { return this.nodes[i] ? this.nodes[i].map((n) => n.piece) : []; }
  allPieces(): Piece[][] { return this.nodes.map((step) => step.map((n) => n.piece)); }
  currentStep(): number { return this.step; }

  /** Put the model on the table: `pos` = table point under the model centre, `rot` = plane rotation. */
  setPlane(pos: vec3, rot: quat) {
    const tf = this.root.getTransform();
    tf.setWorldPosition(pos);
    tf.setWorldRotation(rot);
  }

  worldCentre(): vec3 { return this.root.getTransform().getWorldPosition(); }

  /** The whole finished model, solid (no ghost look), revealed bottom-up. The steps go transparent later. */
  preview() {
    this.root.enabled = true;
    this.mode = "preview";
    this.modeStart = getTime();
    for (const step of this.nodes)
      for (const n of step) {
        n.obj.enabled = true;
        n.tf.setLocalPosition(n.base);
        this.write(n, 0, 0, 0, 1);
      }
  }

  /** Steps before `i` fade to "placed", step `i` drops in and pulses, later steps are hidden. */
  setStep(i: number) {
    this.root.enabled = true;
    this.mode = "step";
    this.step = i;
    this.modeStart = getTime();
    this.nodes.forEach((step, si) =>
      step.forEach((n) => {
        if (si < i) {
          n.obj.enabled = true;
          n.tf.setLocalPosition(n.base);
          this.write(n, 1, 0, 1, this.placedAlpha);
          this.occlude(n, true);
        } else if (si === i) {
          n.obj.enabled = true;
          this.occlude(n, false);
          n.dropStart = this.modeStart;
          n.tf.setLocalPosition(new vec3(n.base.x, n.base.y + DROP_HEIGHT, n.base.z));
          this.write(n, 1, 0.3, 0, 1);
        } else n.obj.enabled = false;
      }),
    );
  }

  /** Replay the drop of the current step. */
  replay() { if (this.mode === "step") this.setStep(this.step); }

  /** Finale: `delay` s from now fade the whole model out over `dur` s, then hide it (the real build stands alone). */
  fadeOut(delay: number, dur: number) {
    this.fadeStart = getTime() + delay;
    this.fadeDur = Math.max(0.1, dur);
  }

  /** Everything solid, with a glow wave running up the model. */
  finish() {
    this.root.enabled = true;
    this.mode = "done";
    this.modeStart = getTime();
    this.fadeStart = -1;
    for (const step of this.nodes)
      for (const n of step) {
        n.obj.enabled = true;
        n.tf.setLocalPosition(n.base);
        this.write(n, 0, 0, 1, 1);
        this.occlude(n, true);
      }
  }

  hide() {
    this.mode = "hidden";
    this.fadeStart = -1;
    this.root.enabled = false;
  }

  private write(n: Node, ghost: number, pulse: number, reveal: number, alpha: number) {
    n.ghost = ghost; n.alpha = alpha;
    try { n.pass[U.ghost] = ghost; n.pass[U.pulse] = pulse; n.pass[U.reveal] = reveal; n.pass[U.alpha] = alpha; } catch (e) {}
  }

  tick(now: number) {
    if (this.mode === "hidden") return;
    const t = now - this.modeStart;
    if (this.mode === "preview") {
      const top = Math.max(1, this.bounds.top);
      for (const step of this.nodes)
        for (const n of step) {
          const k = clamp01((t * 1.3 - (n.piece.y / top) * 1.2) / 0.5);
          const pulse = 0.25 * (1 - k) + 0.03 + 0.03 * Math.sin(t * 3 + n.piece.y);
          try { n.pass[U.reveal] = k; n.pass[U.pulse] = pulse; } catch (e) {}
        }
    } else if (this.mode === "step") {
      const step = this.nodes[this.step];
      if (!step) return;
      for (const n of step) {
        const a = Math.max(0, now - n.dropStart - n.delay);
        const k = clamp01(a / DROP_DUR);
        n.obj.enabled = true;
        n.tf.setLocalPosition(new vec3(n.base.x, n.base.y + DROP_HEIGHT * (1 - easeOutBounce(k)), n.base.z));
        const pulse = k < 1 ? 0.55 : 0.38 + 0.22 * Math.sin((now - n.dropStart) * 4);
        try { n.pass[U.reveal] = a > 0 ? 1 : 0; n.pass[U.pulse] = pulse; n.pass[U.base] = n.color; } catch (e) {}
      }
    } else if (this.mode === "done") {
      const top = Math.max(1, this.bounds.top);
      let f = 1;
      if (this.fadeStart >= 0 && now >= this.fadeStart) {
        const k = Math.min(1, (now - this.fadeStart) / this.fadeDur);
        f = 1 - k * k;
        if (k >= 1) { this.hide(); return; }
      }
      for (const step of this.nodes)
        for (const n of step) {
          const wave = Math.sin(t * 2.2 - (n.piece.y / top) * 3);
          try { n.pass[U.pulse] = (0.12 + 0.3 * Math.max(0, wave)) * f; if (f < 1) n.pass[U.alpha] = f; } catch (e) {}
        }
    }
  }

  clear() {
    for (const step of this.nodes) for (const n of step) { try { n.obj.destroy(); } catch (e) {} }
    this.nodes = [];
  }

  destroy() {
    this.clear();
    try { this.root.destroy(); } catch (e) {}
  }
}
