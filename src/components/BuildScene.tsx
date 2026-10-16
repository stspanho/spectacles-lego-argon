import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Instance, Instances, OrbitControls, RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import type { Design, Inventory, InventoryItem } from "../../shared/types.ts";
import { footprint } from "../../shared/validate.ts";

// Units: 1 = one stud pitch. A DUPLO brick is 19.2 mm tall on a 16 mm pitch → 1.2.
const BRICK_H = 1.2;
const STUD_R = 0.29;
const STUD_H = 0.28;
const PLATE_H = 0.15;

interface Props {
  design: Design;
  inventory: Inventory;
  /** 0-based step being built; steps before it are solid, later ones hidden. -1 = show the finished model. */
  step: number;
  /** Changes to replay the drop animation. */
  replay: number;
}

export function BuildScene({ design, inventory, step, replay }: Props) {
  const items = useMemo(() => new Map(inventory.items.map((i) => [i.id, i])), [inventory]);
  const placements = useMemo(() => layoutPieces(design, items), [design, items]);
  const bounds = useMemo(() => planBounds(placements, inventory), [placements, inventory]);
  const finished = step < 0;
  // Look at the model's middle from a 3/4 view, far enough back to fit its width and height.
  const target: [number, number, number] = [0, bounds.height * 0.45, 0];
  const dist = bounds.size * 1.75;
  const camera: [number, number, number] = [dist * 0.55, target[1] + dist * 0.45, dist * 0.7];

  return (
    <Canvas
      shadows
      camera={{ position: camera, fov: 40 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#f3efe7"]} />
      <hemisphereLight args={["#ffffff", "#b9b2a6", 1.1]} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <group position={[-bounds.cx, 0, -bounds.cz]}>
        {inventory.hasBaseplate && inventory.baseplate && (
          <Baseplate lx={inventory.baseplate.length} lz={inventory.baseplate.width} />
        )}
        {placements.map((pieces, si) => {
          if (!finished && si > step) return null;
          const ghost = !finished && si === step;
          return pieces.map((p, bi) =>
            ghost ? (
              <DroppingBrick key={`${si}-${bi}-${replay}`} piece={p} delay={bi * 0.35} />
            ) : (
              <group key={`${si}-${bi}`} position={p.position}>
                <BrickBody piece={p} />
              </group>
            ),
          );
        })}
      </group>
      <ContactShadows position={[0, -0.01, 0]} opacity={0.35} scale={bounds.size * 2} blur={2.5} far={8} />
      <OrbitControls makeDefault target={target} autoRotate={finished} autoRotateSpeed={1.2} maxPolarAngle={Math.PI * 0.49} />
    </Canvas>
  );
}

interface Piece {
  item: InventoryItem;
  sx: number;
  sz: number;
  /** Rendered height in scene units (plates are thinner than their one logical layer). */
  h: number;
  position: [number, number, number];
}

/** Rendered height: plates use their real thickness, everything else whole brick heights. */
function pieceHeight(item: InventoryItem) {
  return (item.kind === "plate" ? (item.thickness ?? 0.4) : item.height) * BRICK_H;
}

/**
 * Places every piece in build order. `layer` is a logical stacking index (that's what the build check uses);
 * the real height comes from what's underneath, so a thin plate doesn't leave a gap above it.
 */
function layoutPieces(design: Design, items: Map<string, InventoryItem>): Piece[][] {
  const tops = new Map<string, number>(); // "x,z,layer" -> top y of the piece filling that cell
  const key = (x: number, z: number, l: number) => `${x},${z},${l}`;
  return design.steps.map((s) =>
    s.bricks.flatMap((b) => {
      const item = items.get(b.part);
      if (!item) return [];
      const { sx, sz } = footprint(item, b);
      const h = pieceHeight(item);
      let base = b.layer === 0 ? 0 : -1;
      for (let x = b.x; x < b.x + sx; x++)
        for (let z = b.z; z < b.z + sz; z++) base = Math.max(base, tops.get(key(x, z, b.layer - 1)) ?? -1);
      if (base < 0) base = b.layer * BRICK_H; // unsupported (the build check flags it): fall back to the grid
      for (let x = b.x; x < b.x + sx; x++)
        for (let z = b.z; z < b.z + sz; z++)
          for (let l = b.layer; l < b.layer + item.height; l++) tops.set(key(x, z, l), base + h);
      return [{ item, sx, sz, h, position: [b.x + sx / 2, base + h / 2, b.z + sz / 2] as [number, number, number] }];
    }),
  );
}

function planBounds(placements: Piece[][], inventory: Inventory) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = 0;
  for (const p of placements.flat()) {
    x0 = Math.min(x0, p.position[0] - p.sx / 2); x1 = Math.max(x1, p.position[0] + p.sx / 2);
    z0 = Math.min(z0, p.position[2] - p.sz / 2); z1 = Math.max(z1, p.position[2] + p.sz / 2);
    top = Math.max(top, p.position[1] + p.h / 2);
  }
  if (inventory.hasBaseplate && inventory.baseplate) {
    // Centre on the baseplate so the model sits where it will on the real plate.
    [x0, z0, x1, z1] = [0, 0, inventory.baseplate.length, inventory.baseplate.width];
  } else if (!Number.isFinite(x0)) [x0, z0, x1, z1] = [0, 0, 8, 8];
  const lx = x1 - x0, lz = z1 - z0;
  return { cx: x0 + lx / 2, cz: z0 + lz / 2, size: Math.max(lx, lz, top, 6), height: top };
}

function Baseplate({ lx, lz }: { lx: number; lz: number }) {
  return (
    <group>
      <mesh position={[lx / 2, -PLATE_H / 2, lz / 2]} receiveShadow>
        <boxGeometry args={[lx, PLATE_H, lz]} />
        <meshStandardMaterial color="#4c9a4a" roughness={0.6} />
      </mesh>
      <Instances limit={lx * lz} receiveShadow>
        <cylinderGeometry args={[STUD_R, STUD_R, STUD_H * 0.6, 16]} />
        <meshStandardMaterial color="#4c9a4a" roughness={0.6} />
        {Array.from({ length: lx * lz }, (_, i) => (
          <Instance key={i} position={[(i % lx) + 0.5, (STUD_H * 0.6) / 2, Math.floor(i / lx) + 0.5]} />
        ))}
      </Instances>
    </group>
  );
}

function BrickBody({ piece, ghost }: { piece: Piece; ghost?: boolean }) {
  const { item, sx, sz, h } = piece;
  const studs = [];
  for (let x = 0; x < sx; x++)
    for (let z = 0; z < sz; z++)
      studs.push([x - sx / 2 + 0.5, h / 2 + STUD_H / 2, z - sz / 2 + 0.5] as [number, number, number]);
  const material = (
    <meshStandardMaterial
      color={item.hex}
      roughness={0.35}
      transparent={ghost}
      opacity={ghost ? 0.85 : 1}
      emissive={ghost ? item.hex : "#000000"}
      emissiveIntensity={ghost ? 0.25 : 0}
    />
  );
  return (
    <group>
      <RoundedBox args={[sx - 0.02, h - 0.02, sz - 0.02]} radius={0.06} smoothness={3} castShadow receiveShadow>
        {material}
      </RoundedBox>
      {studs.map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <cylinderGeometry args={[STUD_R, STUD_R, STUD_H, 20]} />
          {material}
        </mesh>
      ))}
      {item.kind === "special" && (
        // Special pieces are drawn as their footprint; a ring marks them as "not a plain brick".
        <mesh position={[0, h / 2 + STUD_H + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.5, 24]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
    </group>
  );
}

/** The current step's bricks: fall from above, bounce into place, then pulse until the next step. */
function DroppingBrick({ piece, delay }: { piece: Piece; delay: number }) {
  const ref = useRef<Group>(null);
  const start = useRef<number | null>(null);
  const target = piece.position;

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    start.current ??= clock.elapsedTime;
    const t = Math.max(0, clock.elapsedTime - start.current - delay);
    const k = Math.min(1, t / 0.9);
    g.visible = t > 0;
    g.position.set(target[0], target[1] + 5 * (1 - easeOutBounce(k)), target[2]);
    // Gentle glow pulse once landed, so it's obvious which bricks are new.
    const pulse = k < 1 ? 0.25 : 0.15 + 0.15 * Math.sin((clock.elapsedTime - start.current) * 4);
    g.traverse((o) => {
      const m = (o as { material?: MeshStandardMaterial }).material;
      if (m && "emissiveIntensity" in m) m.emissiveIntensity = pulse;
    });
  });

  return (
    <group ref={ref} position={[target[0], target[1] + 5, target[2]]} visible={false}>
      <BrickBody piece={piece} ghost />
    </group>
  );
}

function easeOutBounce(x: number) {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}
