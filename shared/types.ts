// Shared between the backend, the web client and (later) the Specs lens.
// Units: 1 = one stud pitch horizontally (x, z), one brick height vertically (layer).

/** Bounding box in the uploaded image, normalised 0–1000: [ymin, xmin, ymax, xmax]. */
export type Box2D = [number, number, number, number];

export interface InventoryItem {
  id: string; // e.g. "red-2x4"
  kind: "brick" | "plate" | "special";
  /** Footprint in studs (width ≤ length). */
  width: number;
  length: number;
  /** Height in brick layers (a standard brick is 1; a plate takes 1 layer in the grid too). */
  height: number;
  /** Plates only: real thickness as a fraction of a brick height (e.g. 0.4), used for rendering. */
  thickness?: number;
  color: string; // human name, e.g. "red"
  hex: string; // e.g. "#d01012"
  count: number;
  description: string; // e.g. "2x4 brick" or "giraffe head"
  boxes: Box2D[]; // where each instance is in the photo
}

export interface Inventory {
  hasBaseplate: boolean;
  /** Baseplate size in studs, if one is visible. */
  baseplate?: { width: number; length: number };
  items: InventoryItem[];
  notes: string;
}

export interface PlacedBrick {
  part: string; // InventoryItem.id
  x: number; // stud column of the brick's min corner
  z: number; // stud row of the brick's min corner
  layer: number; // 0 = sitting on the baseplate / table
  /** 0 = length along x, 90 = length along z. */
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
  /** Short fun "comes alive" idea for the finished model. */
  finale: string;
}

export interface ValidationIssue {
  step: number; // 1-based, 0 = whole design
  message: string;
}

export type JobStage =
  | "queued"
  | "inventory"
  | "designing"
  | "validating"
  | "repairing"
  | "done"
  | "error";

export interface JobLogEntry {
  at: string; // ISO time
  message: string;
}

export interface Job {
  id: string;
  stage: JobStage;
  theme: string;
  /** Argon thinking level used for this run. */
  thinking?: "LOW" | "MEDIUM" | "HIGH";
  createdAt: string;
  log: JobLogEntry[];
  inventory?: Inventory;
  design?: Design;
  /** Issues left after the last repair attempt (empty when the design passed). */
  issues?: ValidationIssue[];
  attempts: number;
  error?: string;
  imageUrl: string;
}
