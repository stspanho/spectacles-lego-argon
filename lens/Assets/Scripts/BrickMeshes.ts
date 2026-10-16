import { BRICK_H_CM, STUD_CM } from "./BrickTypes";

/**
 * Procedural DUPLO geometry (MeshBuilder, built once per footprint and cached).
 * Pivot = bottom centre; x/z span the footprint, y goes up. Attributes: position, normal.
 */

const STUD_R = 0.29 * STUD_CM;
export const STUD_H = 0.28 * STUD_CM;
const INSET = 0.03; // cm, so neighbours do not z-fight

class Builder {
  verts: number[] = [];
  idx: number[] = [];
  private n = 0;

  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + sy;
    const faces: [number[], number[]][] = [
      [[0, 1, 0], [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1]], // top
      [[0, -1, 0], [x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0]], // bottom
      [[0, 0, 1], [x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1]], // +z
      [[0, 0, -1], [x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z0]], // -z
      [[1, 0, 0], [x1, y0, z1, x1, y1, z1, x1, y1, z0, x1, y0, z0]], // +x
      [[-1, 0, 0], [x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1]], // -x
    ];
    for (const [nrm, p] of faces) {
      const b = this.n;
      for (let i = 0; i < 4; i++) this.verts.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], nrm[0], nrm[1], nrm[2]);
      this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2); // CCW = front face in LS
      this.n += 4;
    }
  }

  cylinder(cx: number, y0: number, cz: number, r: number, h: number, seg: number) {
    // side
    const b = this.n;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
      this.verts.push(cx + nx * r, y0, cz + nz * r, nx, 0, nz);
      this.verts.push(cx + nx * r, y0 + h, cz + nz * r, nx, 0, nz);
    }
    for (let i = 0; i < seg; i++) {
      const o = b + i * 2;
      this.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); // CCW from outside (the old order was inside-out)
    }
    this.n += (seg + 1) * 2;
    // cap
    const c = this.n;
    this.verts.push(cx, y0 + h, cz, 0, 1, 0);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      this.verts.push(cx + Math.cos(a) * r, y0 + h, cz + Math.sin(a) * r, 0, 1, 0);
    }
    for (let i = 0; i < seg; i++) this.idx.push(c, c + 1 + ((i + 1) % seg), c + 1 + i); // CCW seen from +y
    this.n += seg + 1;
  }

  /** Cylinder along +z (a lens barrel): from z0 to z0 + h, capped at the +z end. */
  cylinderZ(cx: number, cy: number, z0: number, r: number, h: number, seg: number) {
    const b = this.n;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, nx = Math.cos(a), ny = -Math.sin(a); // -sin keeps the same winding as cylinder()
      this.verts.push(cx + nx * r, cy + ny * r, z0, nx, ny, 0);
      this.verts.push(cx + nx * r, cy + ny * r, z0 + h, nx, ny, 0);
    }
    for (let i = 0; i < seg; i++) {
      const o = b + i * 2;
      this.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    this.n += (seg + 1) * 2;
    const c = this.n;
    this.verts.push(cx, cy, z0 + h, 0, 0, 1);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      this.verts.push(cx + Math.cos(a) * r, cy - Math.sin(a) * r, z0 + h, 0, 0, 1);
    }
    for (let i = 0; i < seg; i++) this.idx.push(c, c + 1 + ((i + 1) % seg), c + 1 + i); // CCW seen from +z
    this.n += seg + 1;
  }

  /** Flat disc in the XZ plane at height y, facing +y (same winding as the stud caps). */
  disc(cx: number, y: number, cz: number, r: number, seg: number) {
    const c = this.n;
    this.verts.push(cx, y, cz, 0, 1, 0);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      this.verts.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 0, 1, 0);
    }
    for (let i = 0; i < seg; i++) this.idx.push(c, c + 1 + ((i + 1) % seg), c + 1 + i); // CCW seen from +y
    this.n += seg + 1;
  }

  /** Clockwise-from-outside quad (same convention as box()). */
  quad(p: number[][], n: number[]) {
    const b = this.n;
    for (let i = 0; i < 4; i++) this.verts.push(p[i][0], p[i][1], p[i][2], n[0], n[1], n[2]);
    this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    this.n += 4;
  }

  /** Clockwise-from-outside polygon, fan-triangulated. */
  poly(p: number[][], n: number[]) {
    const b = this.n;
    for (const v of p) this.verts.push(v[0], v[1], v[2], n[0], n[1], n[2]);
    for (let i = 1; i < p.length - 1; i++) this.idx.push(b, b + i + 1, b + i);
    this.n += p.length;
  }

  /**
   * A solid extruded along x from a top profile given back-to-front as [z, y] (y > 0), e.g. a slope or a
   * curved brick. Bottom at y = 0, x centred on 0.
   */
  profileSolid(sx: number, prof: number[][]) {
    const x0 = -sx / 2, x1 = sx / 2;
    const zb = prof[0][0], zf = prof[prof.length - 1][0];
    this.quad([[x0, 0, zf], [x1, 0, zf], [x1, 0, zb], [x0, 0, zb]], [0, -1, 0]);
    this.quad([[x1, 0, zb], [x1, prof[0][1], zb], [x0, prof[0][1], zb], [x0, 0, zb]], [0, 0, -1]);
    const yl = prof[prof.length - 1][1];
    this.quad([[x0, 0, zf], [x0, yl, zf], [x1, yl, zf], [x1, 0, zf]], [0, 0, 1]);
    for (let i = 0; i < prof.length - 1; i++) {
      const [za, ya] = prof[i], [zc, yc] = prof[i + 1];
      const dz = zc - za, dy = yc - ya, l = Math.sqrt(dz * dz + dy * dy) || 1;
      this.quad([[x0, ya, za], [x1, ya, za], [x1, yc, zc], [x0, yc, zc]], [0, dz / l, -dy / l]);
    }
    const left: number[][] = [[x0, 0, zb], [x0, prof[0][1], zb]];
    for (let i = 1; i < prof.length; i++) left.push([x0, prof[i][1], prof[i][0]]);
    left.push([x0, 0, zf]);
    this.poly(left, [-1, 0, 0]);
    const right: number[][] = [[x1, 0, zf], [x1, yl, zf]];
    for (let i = prof.length - 2; i >= 0; i--) right.push([x1, prof[i][1], prof[i][0]]);
    right.push([x1, 0, zb]);
    this.poly(right, [1, 0, 0]);
  }

  /**
   * Like profileSolid, but the TOP profile runs along x (left-to-right [x, y] pairs, y > 0) and the solid is
   * extruded along z (depth sz). Front/back walls are strips between consecutive profile points, so the
   * profile may be concave (a half-pipe).
   */
  profileSolidX(sz: number, prof: number[][]) {
    const z0 = -sz / 2, z1 = sz / 2;
    const xl = prof[0][0], xr = prof[prof.length - 1][0], yl = prof[0][1], yr = prof[prof.length - 1][1];
    this.quad([[xl, 0, z0], [xl, 0, z1], [xr, 0, z1], [xr, 0, z0]], [0, -1, 0]); // bottom
    for (let i = 0; i < prof.length - 1; i++) {
      const [xa, ya] = prof[i], [xc, yc] = prof[i + 1];
      const dx = xc - xa, dy = yc - ya, l = Math.sqrt(dx * dx + dy * dy) || 1;
      this.quad([[xa, ya, z0], [xc, yc, z0], [xc, yc, z1], [xa, ya, z1]], [-dy / l, dx / l, 0]); // top strip
      this.quad([[xa, 0, z0], [xc, 0, z0], [xc, yc, z0], [xa, ya, z0]], [0, 0, -1]); // back wall strip
      this.quad([[xa, 0, z1], [xa, ya, z1], [xc, yc, z1], [xc, 0, z1]], [0, 0, 1]); // front wall strip
    }
    this.quad([[xl, 0, z0], [xl, yl, z0], [xl, yl, z1], [xl, 0, z1]], [-1, 0, 0]); // left end
    this.quad([[xr, 0, z0], [xr, 0, z1], [xr, yr, z1], [xr, yr, z0]], [1, 0, 0]); // right end
  }

  studs(sx: number, sz: number, y: number, rows?: number) {
    for (let x = 0; x < sx; x++)
      for (let z = 0; z < (rows !== undefined ? rows : sz); z++)
        this.cylinder((x - sx / 2 + 0.5) * STUD_CM, y, (z - sz / 2 + 0.5) * STUD_CM, STUD_R, STUD_H, 14);
  }

  mesh(): RenderMesh | null {
    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3, normalized: true },
    ]);
    mb.topology = MeshTopology.Triangles;
    mb.indexType = MeshIndexType.UInt16;
    mb.appendVerticesInterleaved(this.verts);
    mb.appendIndices(this.idx);
    if (!mb.isValid()) { print("[BrickMeshes] ERROR invalid mesh (" + this.verts.length / 6 + " verts, " + this.idx.length + " idx)"); return null; }
    mb.updateMesh();
    print("[BrickMeshes] mesh " + this.verts.length / 6 + " verts, " + this.idx.length / 3 + " tris");
    return mb.getMesh();
  }
}

const cache: { [key: string]: RenderMesh | null } = {};

/**
 * A brick of sx x sz studs and h cm tall, with studs on top unless `studs` is false. `clearR` keeps a circle
 * of that radius in the middle of the top free of studs (a round plate sits there, as on the button box).
 */
export function getBrickMesh(sx: number, sz: number, h: number, studs: boolean = true, clearR: number = 0): RenderMesh | null {
  const key = sx + "x" + sz + "x" + h.toFixed(2) + (studs ? "s" : "") + (clearR > 0 ? "c" + clearR.toFixed(2) : "");
  if (cache[key] !== undefined) return cache[key];
  const b = new Builder();
  b.box(0, 0, 0, sx * STUD_CM - INSET, h - INSET, sz * STUD_CM - INSET);
  if (studs)
    for (let x = 0; x < sx; x++)
      for (let z = 0; z < sz; z++) {
        const cx = (x - sx / 2 + 0.5) * STUD_CM, cz = (z - sz / 2 + 0.5) * STUD_CM;
        if (clearR > 0 && Math.sqrt(cx * cx + cz * cz) < clearR + STUD_R) continue;
        b.cylinder(cx, h - INSET, cz, STUD_R, STUD_H, 14);
      }
  cache[key] = b.mesh();
  return cache[key];
}

/** A plain box, pivot at the bottom centre (frame bars, pads). */
export function getBarMesh(sx: number, h: number, sz: number): RenderMesh | null {
  const key = "bar" + sx.toFixed(2) + "x" + h.toFixed(2) + "x" + sz.toFixed(2);
  if (cache[key] !== undefined) return cache[key];
  const b = new Builder();
  b.box(0, 0, 0, sx, h, sz);
  cache[key] = b.mesh();
  return cache[key];
}

export type BrickShape = "box" | "wedge" | "curved" | "frame" | "arch" | "halfpipe" | "round" | "flower";

/** Shape variants for special pieces; sx/sz in studs, h in cm, pivot bottom centre. */
export function getShapeMesh(shape: BrickShape, sx: number, sz: number, h: number, studs: boolean = true): RenderMesh | null {
  if (shape === "box") return getBrickMesh(sx, sz, h, studs);
  const key = shape + ":" + sx + "x" + sz + "x" + h.toFixed(2) + (studs ? "s" : "");
  if (cache[key] !== undefined) return cache[key];
  const b = new Builder();
  const W = sx * STUD_CM - INSET, D = sz * STUD_CM - INSET, H = h - INSET;
  if (shape === "wedge") {
    // slope: full height at the back, low lip at the front, studs only on the back row
    b.profileSolid(W, [[-D / 2, H], [-D / 2 + Math.min(D * 0.35, STUD_CM * 0.9), H], [D / 2, H * 0.3]]);
    if (studs && sz >= 2) b.studs(sx, sz, H, 1);
  } else if (shape === "curved") {
    const prof: number[][] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      prof.push([-D / 2 + t * D, H * 0.3 + H * 0.7 * Math.cos((t * Math.PI) / 2)]);
    }
    b.profileSolid(W, prof);
    if (studs && sz >= 2) b.studs(sx, sz, H, 1);
  } else if (shape === "frame") {
    // window / door frame: bottom rail, two uprights, top rail (+ studs)
    // (boxes only touch, never overlap: overlapping coplanar faces z-fight)
    const t = STUD_CM * 0.5, rail = Math.max(0.6, H * 0.2);
    b.box(0, 0, 0, W, rail, D);
    b.box(-W / 2 + t / 2, rail, 0, t, H - 2 * rail, D);
    b.box(W / 2 - t / 2, rail, 0, t, H - 2 * rail, D);
    b.box(0, H - rail, 0, W, rail, D);
    if (studs) b.studs(sx, sz, H);
  } else if (shape === "arch") {
    // opening at the bottom: two legs, a beam, a fillet under the beam next to each leg (no overlaps)
    const leg = STUD_CM, beam = H * 0.45, f = STUD_CM * 0.55, fh = (H - beam) * 0.45;
    b.box(-W / 2 + leg / 2, 0, 0, leg, H - beam, D);
    b.box(W / 2 - leg / 2, 0, 0, leg, H - beam, D);
    b.box(0, H - beam, 0, W, beam, D);
    b.box(-W / 2 + leg + f / 2, H - beam - fh, 0, f, fh, D);
    b.box(W / 2 - leg - f / 2, H - beam - fh, 0, f, fh, D);
    if (studs) b.studs(sx, sz, H);
  } else if (shape === "halfpipe") {
    // "inverted arch" / curved cutout on TOP: the top dips in a smooth curve between the two end stud columns
    const end = Math.min(STUD_CM, W / 3), depth = H * 0.62, n = 10;
    const prof: number[][] = [[-W / 2, H], [-W / 2 + end, H]];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      prof.push([-W / 2 + end + t * (W - 2 * end), H - depth * Math.sin(t * Math.PI)]);
    }
    prof.push([W / 2 - end, H], [W / 2, H]);
    b.profileSolidX(D, prof);
    if (studs) for (const x of [0, sx - 1]) for (let z = 0; z < sz; z++) b.cylinder((x - sx / 2 + 0.5) * STUD_CM, H, (z - sz / 2 + 0.5) * STUD_CM, STUD_R, STUD_H, 14);
  } else if (shape === "round") {
    b.cylinder(0, 0, 0, Math.min(W, D) / 2, H, 24);
    if (studs) b.studs(Math.min(sx, 2), Math.min(sz, 2), H);
  } else if (shape === "flower") {
    // DUPLO flower: a thin stem, a small round heart with six thin round petals, a stud on top.
    // Kept small and flat so it does not hide the brick it sits on.
    const r = (Math.min(W, D) / 2) * 0.8;
    const petalT = 0.35, heart = petalT * 1.6;
    const stemH = Math.max(0.5, H - heart - STUD_H);
    b.cylinder(0, 0, 0, r * 0.2, stemH, 10);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, px = Math.cos(a) * r * 0.62, pz = Math.sin(a) * r * 0.62;
      b.cylinder(px, stemH, pz, r * 0.38, petalT, 12);
    }
    b.cylinder(0, stemH, 0, r * 0.42, heart, 14);
    if (studs) b.cylinder(0, stemH + heart, 0, STUD_R, STUD_H, 14);
  }
  cache[key] = b.mesh();
  return cache[key];
}

/** A round plate with small studs around its rim (the grey ring under a LEGO button cap). */
export function getRoundPlateMesh(r: number, h: number, studs: number): RenderMesh | null {
  const key = "rplate" + r.toFixed(2) + "x" + h.toFixed(2) + "x" + studs;
  if (cache[key] !== undefined) return cache[key];
  const b = new Builder();
  b.cylinder(0, 0, 0, r, h, 32);
  for (let i = 0; i < studs; i++) {
    const a = (i / studs) * Math.PI * 2;
    b.cylinder(Math.cos(a) * r * 0.74, h, Math.sin(a) * r * 0.74, Math.min(0.26, r * 0.14), 0.22, 10);
  }
  cache[key] = b.mesh();
  return cache[key];
}

/** A lens barrel pointing +z from the origin (the brick camera's lens). */
export function getLensMesh(r: number, len: number, seg: number = 24): RenderMesh | null {
  const key = "lens" + r.toFixed(2) + "x" + len.toFixed(2) + "x" + seg;
  if (cache[key] !== undefined) return cache[key];
  const b = new Builder();
  b.cylinderZ(0, 0, 0, r, len, seg);
  cache[key] = b.mesh();
  return cache[key];
}

/** The round cap of a LEGO button: a short cylinder with a smaller step on top. */
export function getButtonCapMesh(r: number, h: number): RenderMesh | null {
  const key = "cap" + r.toFixed(2) + "x" + h.toFixed(2);
  if (cache[key] !== undefined) return cache[key];
  const b = new Builder();
  b.cylinder(0, 0, 0, r, h, 32);
  b.cylinder(0, h, 0, r * 0.8, h * 0.25, 32);
  cache[key] = b.mesh();
  return cache[key];
}

let discMesh: RenderMesh | null | undefined;
/** Unit-radius flat disc facing +y (the placement hint's fill). */
export function getDiscMesh(): RenderMesh | null {
  if (discMesh !== undefined) return discMesh;
  const b = new Builder();
  // a very flat cylinder rather than a zero-thickness disc: a flat AABB gets frustum-culled
  b.cylinder(0, -0.02, 0, 1, 0.02, 64);
  discMesh = b.mesh();
  return discMesh;
}

let dustMesh: RenderMesh | null | undefined;
/** Unit-size mini 2x1 brick for the particle shader (scaled in GLSL). */
export function getDustMesh(): RenderMesh | null {
  if (dustMesh !== undefined) return dustMesh;
  const b = new Builder();
  b.box(0, -0.6, 0, 2, 1.2, 1);
  b.cylinder(-0.5, 0.6, 0, 0.3, 0.28, 8);
  b.cylinder(0.5, 0.6, 0, 0.3, 0.28, 8);
  dustMesh = b.mesh();
  return dustMesh;
}

export { BRICK_H_CM };
