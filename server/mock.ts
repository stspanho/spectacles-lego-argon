import type { Design, Inventory } from "../shared/types.ts";

// Used when ARGON_MOCK=1, to test the flow without spending API credits.

export const mockInventory: Inventory = {
  hasBaseplate: true,
  baseplate: { width: 12, length: 12 },
  notes: "Mock inventory (ARGON_MOCK=1).",
  items: [
    { id: "red-2x4", kind: "brick", width: 2, length: 4, height: 1, color: "red", hex: "#d01012", count: 4, description: "2x4 brick", boxes: [[100, 80, 220, 260], [100, 300, 220, 480], [260, 80, 380, 260], [260, 300, 380, 480]] },
    { id: "yellow-2x2", kind: "brick", width: 2, length: 2, height: 1, color: "yellow", hex: "#f5c518", count: 4, description: "2x2 brick", boxes: [[450, 80, 560, 180], [450, 220, 560, 320], [600, 80, 710, 180], [600, 220, 710, 320]] },
    { id: "blue-2x4", kind: "brick", width: 2, length: 4, height: 1, color: "blue", hex: "#0055bf", count: 2, description: "2x4 brick", boxes: [[100, 560, 220, 740], [260, 560, 380, 740]] },
    { id: "green-2x2", kind: "brick", width: 2, length: 2, height: 1, color: "green", hex: "#237841", count: 2, description: "2x2 brick", boxes: [[450, 560, 560, 660], [600, 560, 710, 660]] },
  ],
};

export const mockDesign: Design = {
  title: "Little Lighthouse",
  description: "A red and yellow tower with a blue lamp room and a green top.",
  finale: "The lamp room glows and a beam of light sweeps across the table.",
  steps: [
    { instruction: "Put two red 2x4 bricks side by side in the middle of the plate.", bricks: [
      { part: "red-2x4", x: 4, z: 4, layer: 0, rotation: 0 },
      { part: "red-2x4", x: 4, z: 6, layer: 0, rotation: 0 },
    ] },
    { instruction: "Add four yellow 2x2 bricks on top, one on each corner.", bricks: [
      { part: "yellow-2x2", x: 4, z: 4, layer: 1, rotation: 0 },
      { part: "yellow-2x2", x: 6, z: 4, layer: 1, rotation: 0 },
      { part: "yellow-2x2", x: 4, z: 6, layer: 1, rotation: 0 },
      { part: "yellow-2x2", x: 6, z: 6, layer: 1, rotation: 0 },
    ] },
    { instruction: "Lay two red 2x4 bricks across, turned the other way.", bricks: [
      { part: "red-2x4", x: 4, z: 4, layer: 2, rotation: 90 },
      { part: "red-2x4", x: 6, z: 4, layer: 2, rotation: 90 },
    ] },
    { instruction: "Stack the two blue 2x4 bricks for the lamp room.", bricks: [
      { part: "blue-2x4", x: 4, z: 5, layer: 3, rotation: 0 },
      { part: "blue-2x4", x: 4, z: 5, layer: 4, rotation: 0 },
    ] },
    { instruction: "Finish with the two green 2x2 bricks as the roof.", bricks: [
      { part: "green-2x2", x: 5, z: 5, layer: 5, rotation: 0 },
      { part: "green-2x2", x: 5, z: 5, layer: 6, rotation: 0 },
    ] },
  ],
};
