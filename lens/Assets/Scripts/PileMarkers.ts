import { makeLog } from "./Log";
import { getDiscMesh, getShapeMesh } from "./BrickMeshes";
import { makeHoloMaterial } from "./BrickModel";
import { Inventory, InventoryItem, Piece, STUD_CM, clamp01, hexToColor, pieceHeightCm, shapeOf } from "./BrickTypes";
import { SurfaceProjector } from "./SurfaceProjector";

const log = makeLog("PileMarkers");

const RIM = new vec4(0.9, 0.95, 1.0, 1);
const RIM_HOT = new vec4(1.0, 0.95, 0.6, 1);
const SCALE = 0.45; // mini brick above the real one (its yaw is unknown, so don't pretend to overlay it)
const SCALE_DIM = 0.36; // the pieces not needed right now, while building
const SCALE_HOT = 0.75; // the pieces to pick up now
const HOVER = 4.5; // cm above the real brick's top
const HALO = new vec4(1.0, 0.82, 0.25, 1); // the glow on the table around the real brick to pick up

interface Marker {
  item: InventoryItem;
  obj: SceneObject;
  tf: Transform;
  pass: any;
  pos: vec3; // on the table
  top: number; // the real brick's height (cm)
  phase: number;
  revealAt: number;
  used: boolean;
  hot: boolean;
  hotSince: number;
  mesh: RenderMesh | null;
  halo: SceneObject | null; // additive disc on the table around the real brick (hot only)
  haloPass: any;
  haloR: number;
}

/**
 * One small transparent brick hovering above every detected brick on the real pile: rises out of the
 * brick when revealed, bobs gently, and the instances needed for the current step grow and glow yellow.
 */
export class PileMarkers {
  private markers: Marker[] = [];
  private root: SceneObject;
  private building = false; // a step is active: the pieces not needed now fade back
  public idleAlpha = 0.55;

  constructor(private holoMat: Material) {
    this.root = global.scene.createSceneObject("PileMarkers");
  }

  build(inventory: Inventory, projector: SurfaceProjector, frameId: number, yaw: number): Marker[] {
    this.clear();
    const rot = quat.angleAxis(yaw, vec3.up());
    let skipped = 0;
    for (const item of inventory.items) {
      const boxes = item.boxes && item.boxes.length ? item.boxes : [];
      for (let k = 0; k < boxes.length; k++) {
        const b = boxes[k];
        const u = (b[1] + b[3]) / 2000, v = (b[0] + b[2]) / 2000;
        // the box centre is the brick's MID-height: intersect at that height, then drop to the table
        // (hitting the table plane with the centre ray lands behind the brick)
        const hCm = pieceHeightCm(item);
        const sy = projector.surfaceY();
        if (sy === null) { skipped++; continue; }
        const tableY = sy;
        const mid = projector.toPlane(frameId, u, v, tableY + hCm / 2);
        if (!mid) { skipped++; continue; }
        const pos = new vec3(mid.x, tableY, mid.z);
        const obj = global.scene.createSceneObject("Pile_" + item.id);
        obj.setParent(this.root);
        const tf = obj.getTransform();
        tf.setWorldPosition(pos);
        tf.setWorldRotation(rot);
        tf.setLocalScale(new vec3(0.001, 0.001, 0.001));
        const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        const mesh = getShapeMesh(shapeOf(item), item.length, item.width, hCm, true);
        if (mesh) rmv.mesh = mesh;
        const { mat, pass } = makeHoloMaterial(this.holoMat, hexToColor(item.hex), RIM, 1, this.idleAlpha);
        rmv.mainMaterial = mat;
        try { rmv.renderOrder = 5; } catch (e) {}
        obj.enabled = false;
        this.markers.push({ item, obj, tf, pass, pos, top: hCm, phase: Math.random() * 6.28, revealAt: -1, used: false, hot: false, hotSince: 0, mesh, halo: null, haloPass: null, haloR: 1 });
      }
    }
    log.i("markers: " + this.markers.length + " (" + skipped + " boxes missed the table)");
    return this.markers;
  }

  reveal(stagger: number = 0.12): number {
    const now = getTime();
    this.markers.forEach((m, i) => { m.revealAt = now + i * stagger; });
    return now + this.markers.length * stagger;
  }

  centre(): vec3 | null {
    if (!this.markers.length) return null;
    let x = 0, y = 0, z = 0;
    for (const m of this.markers) { x += m.pos.x; y += m.pos.y; z += m.pos.z; }
    const n = this.markers.length;
    return new vec3(x / n, y / n, z / n);
  }

  markerPositions(): vec3[] { return this.markers.map((m) => m.pos); }

  /** The glow for a hot marker, made on first use: a halo on the table around the real brick. */
  private ensureGlow(m: Marker) {
    if (m.halo) return;
    const halo = global.scene.createSceneObject("Halo");
    halo.setParent(this.root);
    halo.getTransform().setWorldPosition(new vec3(m.pos.x, m.pos.y + 0.15, m.pos.z));
    halo.getTransform().setWorldRotation(m.tf.getWorldRotation());
    m.haloR = Math.max(m.item.length || 2, m.item.width || 2) * STUD_CM * 0.5 + 2.5;
    halo.getTransform().setLocalScale(new vec3(m.haloR, 1, m.haloR));
    const hr = halo.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const dm = getDiscMesh();
    if (dm) hr.mesh = dm;
    const h = makeHoloMaterial(this.holoMat, HALO, HALO, 0, 0.5);
    try { h.pass.blendMode = BlendMode.Add; h.pass.depthWrite = false; } catch (e) {}
    hr.mainMaterial = h.mat;
    try { hr.renderOrder = 4; } catch (e) {}
    m.halo = halo;
    m.haloPass = h.pass;
  }

  /** Instances for steps before `step` are used (dim), the ones for `step` glow. Returns the glowing positions. */
  highlightStep(placements: Piece[][], step: number): vec3[] {
    const now = getTime();
    for (const m of this.markers) { m.used = false; m.hot = false; }
    this.building = step < placements.length;
    const take = (p: Piece, hot: boolean): vec3 | null => {
      const m = this.markers.find((x) => x.item.id === p.item.id && !x.used && !x.hot);
      if (!m) return null;
      if (hot) { m.hot = true; m.hotSince = now; this.ensureGlow(m); } else m.used = true;
      return m.pos;
    };
    for (let s = 0; s < step && s < placements.length; s++) for (const p of placements[s]) take(p, false);
    const out: vec3[] = [];
    if (step < placements.length) for (const p of placements[step]) { const pos = take(p, true); if (pos) out.push(pos); }
    return out;
  }

  tick(now: number) {
    for (const m of this.markers) {
      if (m.revealAt < 0 || now < m.revealAt) continue;
      const k = clamp01((now - m.revealAt) / 0.6);
      if (!m.obj.enabled) m.obj.enabled = true;
      const ease = 1 - (1 - k) * (1 - k);
      const target = m.hot ? SCALE_HOT : (m.used ? SCALE * 0.6 : (this.building ? SCALE_DIM : SCALE));
      const pop = k < 1 ? 1 + 0.3 * Math.sin(k * Math.PI) : 1;
      const sc = Math.max(0.001, target * ease * pop);
      m.tf.setLocalScale(new vec3(sc, sc, sc));
      const hs = now - m.hotSince;
      const bob = m.hot ? 1.0 * Math.sin(hs * 4) : 0.5 * Math.sin(now * 2 + m.phase);
      const hover = (m.top + (m.hot ? HOVER + 1.5 : HOVER)) * ease + bob;
      m.tf.setWorldPosition(new vec3(m.pos.x, m.pos.y + hover, m.pos.z));
      let pulse = (1 - k) * 0.8;
      let alpha = this.building ? 0.28 : this.idleAlpha;
      if (m.hot) { pulse = 0.28 + 0.12 * Math.sin(hs * 4); alpha = 1; } // just the brick, a bit brighter
      else if (m.used) alpha = 0.08;
      try { m.pass["pulse"] = pulse; m.pass["alphaMul"] = alpha; m.pass["rimColor"] = m.hot ? RIM_HOT : RIM; } catch (e) {}
      if (m.halo) {
        const on = m.hot && m.obj.enabled;
        if (m.halo.enabled !== on) m.halo.enabled = on;
        if (on) {
          const breathe = 0.5 + 0.5 * Math.sin(hs * 4);
          const r = m.haloR * (1 + 0.1 * breathe);
          m.halo.getTransform().setLocalScale(new vec3(r, 1, r));
          try { m.haloPass["alphaMul"] = 0.3 + 0.35 * breathe; m.haloPass["pulse"] = 0.5; } catch (e) {}
        }
      }
    }
  }

  clear() {
    for (const m of this.markers) { try { m.obj.destroy(); } catch (e) {} try { if (m.halo) m.halo.destroy(); } catch (e) {} }
    this.markers = [];
    this.building = false;
  }
}
