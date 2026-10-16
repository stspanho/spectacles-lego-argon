import type { Design, Inventory, InventoryItem, PlacedBrick, ValidationIssue } from "./types.ts";

/** Footprint of a placed brick in studs, after rotation. */
export function footprint(item: InventoryItem, b: PlacedBrick) {
  // Rotation 0 runs the length along x; 90 runs it along z.
  return b.rotation === 90 ? { sx: item.width, sz: item.length } : { sx: item.length, sz: item.width };
}

const key = (x: number, z: number, layer: number) => `${x},${z},${layer}`;

/**
 * Checks that a design can actually be built from the inventory, in order:
 * parts exist and counts suffice, no overlaps, fits the baseplate,
 * and every brick rests on something already placed (or the ground).
 */
export function validateDesign(design: Design, inventory: Inventory): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const items = new Map(inventory.items.map((i) => [i.id, i]));
  const used = new Map<string, number>();
  const occupied = new Map<string, string>(); // cell -> label of the brick in it
  const plate = inventory.hasBaseplate ? inventory.baseplate : undefined;

  if (design.steps.length === 0) issues.push({ step: 0, message: "Design has no steps." });

  design.steps.forEach((step, si) => {
    const stepNo = si + 1;
    if (step.bricks.length === 0) issues.push({ step: stepNo, message: "Step places no bricks." });

    step.bricks.forEach((b, bi) => {
      const label = `step ${stepNo} brick ${bi + 1} (${b.part} at x=${b.x}, z=${b.z}, layer=${b.layer})`;
      const item = items.get(b.part);
      if (!item) {
        issues.push({ step: stepNo, message: `${label}: part "${b.part}" is not in the inventory.` });
        return;
      }
      used.set(b.part, (used.get(b.part) ?? 0) + 1);

      if (![b.x, b.z, b.layer].every(Number.isInteger) || b.layer < 0) {
        issues.push({ step: stepNo, message: `${label}: x, z and layer must be integers, layer ≥ 0.` });
        return;
      }

      const { sx, sz } = footprint(item, b);
      if (plate && (b.x < 0 || b.z < 0 || b.x + sx > plate.length || b.z + sz > plate.width)) {
        issues.push({
          step: stepNo,
          message: `${label}: sticks out of the ${plate.length}x${plate.width} baseplate (x 0..${plate.length - 1}, z 0..${plate.width - 1}).`,
        });
      }

      // Support: at least one stud under the bottom layer must already be filled (or be the ground).
      if (b.layer > 0) {
        let supported = false;
        for (let x = b.x; x < b.x + sx && !supported; x++)
          for (let z = b.z; z < b.z + sz && !supported; z++)
            if (occupied.has(key(x, z, b.layer - 1))) supported = true;
        if (!supported) issues.push({ step: stepNo, message: `${label}: floats — nothing under it at layer ${b.layer - 1}.` });
      }

      for (let x = b.x; x < b.x + sx; x++)
        for (let z = b.z; z < b.z + sz; z++)
          for (let y = b.layer; y < b.layer + item.height; y++) {
            const other = occupied.get(key(x, z, y));
            if (other) issues.push({ step: stepNo, message: `${label}: overlaps ${other} at x=${x}, z=${z}, layer=${y}.` });
            else occupied.set(key(x, z, y), label);
          }
    });
  });

  for (const [part, n] of used) {
    const item = items.get(part);
    if (item && n > item.count) issues.push({ step: 0, message: `Uses ${n}× "${part}" but only ${item.count} available.` });
  }

  // Dedupe overlap spam: one message per brick pair is enough.
  return [...new Map(issues.map((i) => [i.message.replace(/ at x=\d+, z=\d+, layer=\d+\.$/, ""), i])).values()];
}
