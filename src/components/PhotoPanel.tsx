import { useMemo } from "react";
import type { Box2D, Design, Inventory } from "../../shared/types.ts";

interface Props {
  src: string;
  inventory: Inventory;
  design?: Design;
  /** 0-based step; -1 = no highlight (shows the whole inventory). */
  step: number;
}

/**
 * The photo with Argon's detections on top. During building, only the pieces to pick for the
 * current step are highlighted — one specific instance each, skipping ones used in earlier steps.
 * (This is the "glow in your pile" part that moves to the Specs lens later.)
 */
export function PhotoPanel({ src, inventory, design, step }: Props) {
  const boxes = useMemo(() => {
    const colors = new Map(inventory.items.map((i) => [i.id, i.hex]));
    if (!design || step < 0) {
      return inventory.items.flatMap((item) =>
        item.boxes.map((box) => ({ box, color: item.hex, label: item.id, active: false })),
      );
    }
    const used = new Map<string, number>();
    for (let s = 0; s < step; s++) for (const b of design.steps[s].bricks) used.set(b.part, (used.get(b.part) ?? 0) + 1);
    const items = new Map(inventory.items.map((i) => [i.id, i]));
    const out: { box: Box2D; color: string; label: string; active: boolean }[] = [];
    for (const b of design.steps[step]?.bricks ?? []) {
      const n = used.get(b.part) ?? 0;
      used.set(b.part, n + 1);
      const box = items.get(b.part)?.boxes[n];
      if (box) out.push({ box, color: colors.get(b.part) ?? "#fff", label: b.part, active: true });
    }
    return out;
  }, [inventory, design, step]);

  return (
    <div className="photo">
      <img src={src} alt="Your bricks" />
      {boxes.map(({ box: [y0, x0, y1, x1], color, label, active }, i) => (
        <div
          key={i}
          className={active ? "box active" : "box"}
          style={{
            top: `${y0 / 10}%`,
            left: `${x0 / 10}%`,
            height: `${(y1 - y0) / 10}%`,
            width: `${(x1 - x0) / 10}%`,
            ["--c" as string]: color,
          }}
        >
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
