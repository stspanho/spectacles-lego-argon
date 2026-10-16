import { makeLog } from "./Log";
import { getDustMesh } from "./BrickMeshes";
import { clamp01 } from "./BrickTypes";

const log = makeLog("BrickDust");

// Uniform names = the input names in Assets/Shaders/BrickDust.glsl.
const U_CENTRE = "centreW", U_A = "dustA", U_B = "dustB";
const U_COLS = ["colA", "colB", "colC", "colD"];
export const LEGO_PALETTE = [
  new vec4(0.89, 0.09, 0.14, 1), new vec4(1.0, 0.8, 0.0, 1), new vec4(0.0, 0.42, 0.83, 1), new vec4(0.16, 0.65, 0.27, 1),
];

/** One instanced draw of mini bricks. The object sits at identity at the scene root (world == object). */
export class DustLayer {
  readonly obj: SceneObject;
  private pass: any = null;
  private a = new vec4(30, 0, 0, 0.5);
  private b = new vec4(0, 1, 6, 1.5);
  private c = new vec3(0, 0, 0);

  constructor(mat: Material, count: number, name: string) {
    this.obj = global.scene.createSceneObject("BrickDust_" + name);
    const rmv = this.obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const mesh = getDustMesh();
    if (mesh) rmv.mesh = mesh;
    const m = mat.clone();
    const pass: any = m.mainPass;
    this.pass = pass;
    try { pass.instanceCount = count; } catch (e) { log.e("instanceCount: " + e); }
    // blend mode stays as baked in the .mat (Disabled = opaque)
    try { pass.depthWrite = true; pass.depthTest = true; pass.twoSided = false; } catch (e) {}
    try {
      pass.frustumCullMode = FrustumCullMode.UserDefinedAABB;
      pass.frustumCullMin = new vec3(-100000, -100000, -100000);
      pass.frustumCullMax = new vec3(100000, 100000, 100000);
    } catch (e) {}
    this.setPalette(LEGO_PALETTE);
    rmv.mainMaterial = m;
    try { rmv.renderOrder = 0; } catch (e) {}
    this.obj.enabled = false;
    try {
      log.d(name + ": mesh=" + (mesh ? "ok" : "NULL") + " instanceCount=" + pass.instanceCount + " blend=" + pass.blendMode + " cull=" + pass.frustumCullMode + " dustA=" + pass[U_A] + " colA=" + pass[U_COLS[0]]);
    } catch (e) { log.w("readback failed: " + e); }
  }

  setPalette(cols: vec4[]) {
    for (let i = 0; i < 4; i++) {
      const c = cols[i % cols.length];
      try { this.pass[U_COLS[i]] = new vec4(c.x, c.y, c.z, 1); } catch (e) {}
    }
  }

  set(centre: vec3, radius: number, progress: number, mode: number, sizeMul: number, seed: number, fade: number, lift: number, spin: number) {
    this.c.x = centre.x; this.c.y = centre.y; this.c.z = centre.z;
    this.a.x = radius; this.a.y = progress; this.a.z = mode; this.a.w = sizeMul;
    this.b.x = seed; this.b.y = fade; this.b.z = lift; this.b.w = spin;
    try { this.pass[U_CENTRE] = this.c; this.pass[U_A] = this.a; this.pass[U_B] = this.b; } catch (e) {}
  }

  setEnabled(on: boolean) { if (!isNull(this.obj) && this.obj.enabled !== on) this.obj.enabled = on; }
  destroy() { try { if (!isNull(this.obj)) this.obj.destroy(); } catch (e) {} }
}

interface Shot {
  layer: DustLayer;
  centre: vec3;
  radius: number;
  mode: number;
  sizeMul: number;
  seed: number;
  lift: number;
  spin: number;
  start: number;
  dur: number;
  busy: boolean;
}

/** Scan cloud (continuous) + pooled bursts / converges (progress 0..1 driven). */
export class DustFx {
  private scan: DustLayer;
  private scanCentre: vec3 = vec3.zero();
  private scanR = 30;
  private scanFade = 0; // current
  private scanTarget = 0; // 0 = off, 1 = on
  private shots: Shot[] = [];
  private nextShot = 0;

  constructor(mat: Material, scanCount: number = 240, shotCount: number = 90, shots: number = 5) {
    this.scan = new DustLayer(mat, scanCount, "scan");
    for (let i = 0; i < shots; i++) {
      this.shots.push({
        layer: new DustLayer(mat, shotCount, "shot" + i), centre: vec3.zero(), radius: 10, mode: 1, sizeMul: 0.5,
        seed: 0, lift: 10, spin: 2, start: 0, dur: 1, busy: false,
      });
    }
  }

  /** Dust cloud lying on the table around `centre` (y = table). */
  scanCloud(centre: vec3, radius: number) {
    this.scanCentre = new vec3(centre.x, centre.y, centre.z);
    this.scanR = radius;
    this.scanTarget = 1;
    this.scan.setEnabled(true);
  }

  stopScan() { this.scanTarget = 0; }

  /** Fountain of bricks from `centre`. */
  burst(centre: vec3, radius: number = 14, lift: number = 12, sizeMul: number = 0.55, palette: vec4[] | null = null, dur: number = 1.4) {
    this.fire(centre, radius, 1, sizeMul, lift, 2.5, dur, palette);
  }

  /** Bricks spiral in onto `centre` and vanish. */
  converge(centre: vec3, radius: number = 9, sizeMul: number = 0.4, palette: vec4[] | null = null, dur: number = 0.9) {
    this.fire(centre, radius, 2, sizeMul, 4, 3, dur, palette);
  }

  private fire(centre: vec3, radius: number, mode: number, sizeMul: number, lift: number, spin: number, dur: number, palette: vec4[] | null) {
    const s = this.shots[this.nextShot++ % this.shots.length];
    s.centre = new vec3(centre.x, centre.y, centre.z);
    s.radius = radius; s.mode = mode; s.sizeMul = sizeMul; s.lift = lift; s.spin = spin; s.dur = dur;
    s.seed = Math.floor(Math.random() * 97) + Math.random();
    s.start = getTime();
    s.busy = true;
    s.layer.setPalette(palette && palette.length ? palette : LEGO_PALETTE);
    s.layer.set(s.centre, s.radius, 0, s.mode, s.sizeMul, s.seed, 1, s.lift, s.spin);
    s.layer.setEnabled(true);
    log.d("fire mode=" + mode + " at (" + centre.x.toFixed(0) + "," + centre.y.toFixed(0) + "," + centre.z.toFixed(0) + ") R=" + radius + " enabled=" + s.layer.obj.enabled);
  }

  tick(now: number, dt: number) {
    // scan cloud fade
    if (this.scanFade !== this.scanTarget) {
      const k = this.scanTarget > this.scanFade ? dt / 0.45 : dt / 0.7;
      this.scanFade = this.scanTarget > this.scanFade ? Math.min(this.scanTarget, this.scanFade + k) : Math.max(this.scanTarget, this.scanFade - k);
    }
    if (this.scanFade > 0 || this.scanTarget > 0) {
      this.scan.set(this.scanCentre, this.scanR, 0, 0, 0.45, 7.3, this.scanFade, 5, 1.2);
      this.scan.setEnabled(this.scanFade > 0.001);
    }
    for (const s of this.shots) {
      if (!s.busy) continue;
      const k = clamp01((now - s.start) / s.dur);
      const eased = s.mode === 1 ? 1 - Math.pow(1 - k, 2.2) : k; // bursts ease out, converges linear (eased in GLSL)
      s.layer.set(s.centre, s.radius, eased, s.mode, s.sizeMul, s.seed, 1, s.lift, s.spin);
      if (k >= 1) { s.busy = false; s.layer.setEnabled(false); }
    }
  }

  destroy() {
    this.scan.destroy();
    for (const s of this.shots) s.layer.destroy();
  }
}
