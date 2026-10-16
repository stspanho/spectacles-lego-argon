// Mirrors brick-builder/shared/types.ts + the layout maths of BuildScene.tsx. Keep in sync by hand.
// Grid units: 1 = one stud pitch (x, z), `layer` = one brick height. Scene units here are cm.

/** Bounding box in the scanned image, normalised 0-1000: [ymin, xmin, ymax, xmax]. */
export type Box2D = [number, number, number, number];

export interface InventoryItem {
  id: string;
  kind: "brick" | "plate" | "special";
  width: number;
  length: number;
  height: number;
  thickness?: number;
  color: string;
  hex: string;
  count: number;
  description: string;
  boxes: Box2D[];
}

export interface Inventory {
  hasBaseplate: boolean;
  baseplate?: { width: number; length: number };
  items: InventoryItem[];
  notes: string;
}

export interface PlacedBrick {
  part: string;
  x: number;
  z: number;
  layer: number;
  rotation: 0 | 90;
}

export interface BuildStep {
  instruction: string;
  bricks: PlacedBrick[];
}

export interface Design {
  title: string;
  description: string;
  steps: BuildStep[];
  finale: string;
}

export interface Job {
  id: string;
  stage: string;
  theme: string;
  log: { at: string; message: string }[];
  inventory?: Inventory;
  design?: Design;
  issues?: { step: number; message: string }[];
  error?: string;
}

// DUPLO: 16 mm stud pitch, 19.2 mm brick height.
export const STUD_CM = 1.6;
export const BRICK_H_CM = 1.92;

export function footprint(item: InventoryItem, b: PlacedBrick): { sx: number; sz: number } {
  return b.rotation === 90 ? { sx: item.width, sz: item.length } : { sx: item.length, sz: item.width };
}

/** Rendered height in cm: plates use their real thickness, everything else whole brick heights. */
export function pieceHeightCm(item: InventoryItem): number {
  const f = item.kind === "plate" ? (item.thickness !== undefined ? item.thickness : 0.4) : item.height;
  return f * BRICK_H_CM;
}

/** One placed piece, model-local, in cm. (x, z) = bottom-centre; y = bottom. */
export interface Piece {
  item: InventoryItem;
  sx: number; // studs
  sz: number;
  h: number; // cm
  x: number; // cm, centre
  y: number; // cm, bottom
  z: number; // cm, centre
  step: number;
}

/**
 * Places every piece in build order. `layer` is a logical stacking index (what the build check uses);
 * the real height comes from what is underneath, so a thin plate leaves no gap above it.
 */
export function layoutPieces(design: Design, inventory: Inventory): Piece[][] {
  const items: { [id: string]: InventoryItem } = {};
  for (const it of inventory.items) items[it.id] = it;
  const tops: { [key: string]: number } = {}; // "x,z,layer" -> top y (cm) of the piece filling that cell
  const key = (x: number, z: number, l: number) => x + "," + z + "," + l;
  return design.steps.map((s, si) => {
    const out: Piece[] = [];
    for (const b of s.bricks) {
      const item = items[b.part];
      if (!item) continue;
      const fp = footprint(item, b);
      const h = pieceHeightCm(item);
      let base = b.layer === 0 ? 0 : -1;
      for (let x = b.x; x < b.x + fp.sx; x++)
        for (let z = b.z; z < b.z + fp.sz; z++) {
          const t = tops[key(x, z, b.layer - 1)];
          if (t !== undefined && t > base) base = t;
        }
      if (base < 0) base = b.layer * BRICK_H_CM; // unsupported: fall back to the grid
      for (let x = b.x; x < b.x + fp.sx; x++)
        for (let z = b.z; z < b.z + fp.sz; z++)
          for (let l = b.layer; l < b.layer + item.height; l++) tops[key(x, z, l)] = base + h;
      out.push({
        item,
        sx: fp.sx,
        sz: fp.sz,
        h,
        x: (b.x + fp.sx / 2) * STUD_CM,
        y: base,
        z: (b.z + fp.sz / 2) * STUD_CM,
        step: si,
      });
    }
    return out;
  });
}

export interface Bounds {
  cx: number;
  cz: number;
  lx: number;
  lz: number;
  top: number;
}

export function modelBounds(placements: Piece[][]): Bounds {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = 0;
  for (const step of placements)
    for (const p of step) {
      const hx = (p.sx * STUD_CM) / 2, hz = (p.sz * STUD_CM) / 2;
      if (p.x - hx < x0) x0 = p.x - hx;
      if (p.x + hx > x1) x1 = p.x + hx;
      if (p.z - hz < z0) z0 = p.z - hz;
      if (p.z + hz > z1) z1 = p.z + hz;
      if (p.y + p.h > top) top = p.y + p.h;
    }
  if (!isFinite(x0)) { x0 = 0; z0 = 0; x1 = 8 * STUD_CM; z1 = 8 * STUD_CM; }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, lx: x1 - x0, lz: z1 - z0, top };
}

/** Pick a render shape for a piece from Argon's id/description (special pieces only). */
export type BrickShape = "box" | "wedge" | "curved" | "frame" | "arch" | "halfpipe" | "round" | "flower";

export function shapeOf(item: InventoryItem): BrickShape {
  if (item.kind !== "special") return "box";
  const t = ((item.id || "") + " " + (item.description || "")).toLowerCase();
  if (/flower|petal|leaf|leaves|plant|blossom/.test(t)) return "flower";
  if (/inverted arch|half-?pipe|curved (cutout|cut-out|top|dip)|concave|scoop/.test(t)) return "halfpipe"; // the dip is on TOP
  if (/\barch|bridge|gate|cutout|cut-out|notch|tunnel/.test(t)) return "arch"; // opening at the bottom
  if (/window|door|frame|lattice/.test(t)) return "frame";
  if (/\bslope|wedge|roof/.test(t)) return "wedge";
  if (/curv|rounded top|\barc\b/.test(t)) return "curved";
  if (/\bround\b|cylinder|barrel|tube|wheel|dome/.test(t)) return "round";
  return "box";
}

export function hexToColor(hex: string, a: number = 1): vec4 {
  let h = (hex || "#888888").replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (isNaN(n)) return new vec4(0.6, 0.6, 0.6, a);
  return new vec4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

export function easeOutBounce(x: number): number {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
