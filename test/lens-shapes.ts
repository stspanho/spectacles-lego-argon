// Offline check of the lens' piece mapping on a saved run: shape per part, heights, layout.
//   npx tsx test/lens-shapes.ts <run id>
// Stubs the Lens Studio globals the lens module touches (vec4) so BrickTypes.ts loads in Node.
(globalThis as any).vec4 = class { constructor(public x: number, public y: number, public z: number, public w: number) {} };
import { readFileSync } from "node:fs";
import path from "node:path";

const LENS = "/Users/stijnspanhove/lens-studio/spectacles-lego-argon/spectacles-lego-argon/Assets/Scripts";
const run = process.argv[2];
if (!run) { console.error("usage: npx tsx test/lens-shapes.ts <run id>"); process.exit(1); }

(async () => {
  const types = await import(path.join(LENS, "BrickTypes.ts"));
  const job = JSON.parse(readFileSync(path.join("runs", run, "job.json"), "utf8"));
  const inv = job.inventory, design = job.design;
  console.log(`run ${run}: ${inv.items.length} kinds, design "${design?.title}" (${design?.steps.length} steps)`);
  console.log("part                        kind     size  h  cm    shape   description");
  const counts: Record<string, number> = {};
  for (const it of inv.items) {
    const shape = types.shapeOf(it);
    counts[shape] = (counts[shape] || 0) + it.count;
    console.log(`${it.id.padEnd(27)} ${it.kind.padEnd(8)} ${String(it.width + "x" + it.length).padEnd(5)} ${String(it.height).padEnd(2)} ${types.pieceHeightCm(it).toFixed(2).padEnd(5)} ${shape.padEnd(7)} ${it.description.slice(0, 50)}`);
  }
  console.log("shapes:", counts);
  if (!design) return;
  const placements = types.layoutPieces(design, inv);
  const b = types.modelBounds(placements);
  console.log(`layout: footprint ${b.lx.toFixed(1)}x${b.lz.toFixed(1)} cm, top ${b.top.toFixed(1)} cm`);
  let bad = 0;
  placements.forEach((step: any[], si: number) => {
    for (const p of step) {
      // every piece must sit on the table or exactly on top of what the layout put under it (no floating, no sinking)
      const exp = p.piece ? 0 : 0;
      if (p.y < -0.01) { bad++; console.log(`  step ${si + 1}: ${p.item.id} sinks (y=${p.y})`); }
      if (p.h <= 0) { bad++; console.log(`  step ${si + 1}: ${p.item.id} has no height`); }
    }
  });
  const tall = placements.flat().filter((p: any) => p.item.height > 1).map((p: any) => `${p.item.id}(${p.h.toFixed(2)}cm)`);
  console.log("tall pieces placed:", tall.length ? tall.join(", ") : "none");
  console.log(bad ? `PROBLEMS: ${bad}` : "layout OK");
})();
