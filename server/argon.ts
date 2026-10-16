import { GoogleGenAI, MediaResolution, ThinkingLevel } from "@google/genai";
import type { Design, Inventory, ValidationIssue } from "../shared/types.ts";

const MODEL = process.env.ARGON_MODEL || "gemini-4-argon";
export const THINKING_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type Thinking = (typeof THINKING_LEVELS)[number];
const envThinking = (process.env.ARGON_THINKING || "HIGH").toUpperCase() as Thinking;
export const defaultThinking: Thinking = THINKING_LEVELS.includes(envThinking) ? envThinking : "HIGH";

let client: GoogleGenAI | undefined;
function ai() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set in .env");
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

export interface ArgonCall<T> {
  data: T;
  raw: string;
  ms: number;
  usage?: unknown;
}

async function generateJson<T>(parts: object[], schema: object, thinking: Thinking): Promise<ArgonCall<T>> {
  const started = Date.now();
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      thinkingConfig: { thinkingLevel: ThinkingLevel[thinking] },
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
    },
  });
  const raw = res.text ?? "";
  if (!raw) throw new Error(`Empty response from ${MODEL} (finish reason: ${res.candidates?.[0]?.finishReason ?? "unknown"})`);
  return { data: JSON.parse(raw) as T, raw, ms: Date.now() - started, usage: res.usageMetadata };
}

export interface Img {
  data: Buffer;
  mimeType: string;
}

const imagePart = (img: Img) => ({ inlineData: { mimeType: img.mimeType, data: img.data.toString("base64") } });

// ---------- Schemas ----------

const box = { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 };

const inventorySchema = {
  type: "object",
  properties: {
    hasBaseplate: { type: "boolean" },
    baseplate: {
      type: "object",
      properties: { width: { type: "integer" }, length: { type: "integer" } },
      required: ["width", "length"],
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["brick", "plate", "special"] },
          width: { type: "integer" },
          length: { type: "integer" },
          height: { type: "integer" },
          thickness: { type: "number" },
          color: { type: "string" },
          hex: { type: "string" },
          count: { type: "integer" },
          description: { type: "string" },
          boxes: { type: "array", items: box },
        },
        required: ["id", "kind", "width", "length", "height", "color", "hex", "count", "description", "boxes"],
      },
    },
    notes: { type: "string" },
  },
  required: ["hasBaseplate", "items", "notes"],
};

const designSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    finale: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: { type: "string" },
          bricks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                part: { type: "string" },
                x: { type: "integer" },
                z: { type: "integer" },
                layer: { type: "integer" },
                rotation: { type: "integer", enum: [0, 90] },
              },
              required: ["part", "x", "z", "layer", "rotation"],
            },
          },
        },
        required: ["instruction", "bricks"],
      },
    },
  },
  required: ["title", "description", "finale", "steps"],
};

// ---------- Prompts ----------

const INVENTORY_PROMPT = `You are looking at a photo of LEGO DUPLO (or LEGO) pieces spread on a table.
Make an exact inventory of every piece you can see.

Rules:
- Group identical pieces (same shape, size and colour) into one item with a count.
- id: lowercase "<color>-<width>x<length>" for bricks (e.g. "red-2x4"); a short slug for special pieces (e.g. "yellow-duck-head").
- width/length: footprint in studs, width ≤ length. height: in standard brick heights (a normal DUPLO brick = 1; use 1 for flat/low pieces too). Look carefully for TALL bricks: a brick whose side is twice as high as a normal brick is height 2 (three times = 3); compare each brick's side face with its neighbours.
- kind "plate" for flat studded plates thinner than a brick; set height 1 and thickness = its real thickness as a fraction of a standard brick height (e.g. 0.4).
- kind "special" for anything that isn't a plain rectangular brick (figures, animals, slopes, wheels, windows…). Still give its footprint.
- hex: a colour close to the real plastic, e.g. "#d01012" for red.
- boxes: one [ymin, xmin, ymax, xmax] box per instance, normalised to 0–1000 of the image. The number of boxes must equal count.
- A baseplate is a large flat studded plate; report it via hasBaseplate/baseplate (in studs, width ≤ length) and do NOT list it as an item.
- notes: anything uncertain (hidden pieces, unsure counts).`;

function designPrompt(inventory: Inventory, theme: string) {
  const plate = inventory.hasBaseplate && inventory.baseplate
    ? `There is a ${inventory.baseplate.length}x${inventory.baseplate.width} baseplate: x runs 0..${inventory.baseplate.length - 1}, z runs 0..${inventory.baseplate.width - 1}.`
    : "There is no baseplate: build on the table, keep x and z ≥ 0.";
  return `Design ONE recognisable figure to build from ONLY these pieces: something a kid can name at a glance from its silhouette alone (a robot, an animal, a vehicle, a rocket, a character...). NOT a scene, landscape, island, temple or building. Theme: "${theme || "surprise me: a robot, an animal, a vehicle or a character"}".
Give it a name that says what it is ("Robo the Robot"). It should be sturdy and fun for a kid to build; shape the body, head, limbs or wheels clearly, with colour used for features (eyes, buttons, windows). Use as many pieces as makes sense (aim for 10–40), not necessarily all.

Inventory (JSON):
${JSON.stringify(inventory.items.map(({ boxes: _b, ...i }) => i), null, 1)}

Coordinate system (stud grid):
- ${plate}
- A brick at (x, z) with rotation 0 covers x..x+length-1 and z..z+width-1. rotation 90 swaps them (covers x..x+width-1, z..z+length-1).
- layer 0 sits on the baseplate/table; a brick at layer n must sit on at least one stud of a piece occupying layer n-1 that was placed before it (an earlier step, or earlier in the same step's list).
- A piece with height h occupies layers layer..layer+h-1 (a plate occupies one layer). No two pieces may share a cell.
- Never use more of a part than its count. Only use part ids from the inventory.

Steps:
- Order bricks bottom-up so every brick is supported when placed.
- 1–3 bricks per step; group symmetric pairs in one step.
- instruction: one short, friendly sentence a kid understands, naming colour and position ("Put the red 2x4 on the left edge, sticking out one stud").
- finale: a short idea for how the finished model could "come alive" in AR (e.g. "the dragon flaps its wings and puffs smoke").`;
}

function repairPrompt(design: Design, issues: ValidationIssue[]) {
  return `Your previous design failed an automatic build check. Fix ALL problems and return the full corrected design (same JSON format). Keep the idea; move, swap or remove bricks as needed.

Problems:
${issues.map((i) => `- ${i.message}`).join("\n")}

Previous design:
${JSON.stringify(design)}`;
}

// ---------- Calls ----------

export const model = MODEL;

export function makeInventory(img: Img, thinking = defaultThinking) {
  return generateJson<Inventory>([imagePart(img), { text: INVENTORY_PROMPT }], inventorySchema, thinking);
}

export function makeDesign(img: Img, inventory: Inventory, theme: string, thinking = defaultThinking) {
  return generateJson<Design>([imagePart(img), { text: designPrompt(inventory, theme) }], designSchema, thinking);
}

export function repairDesign(
  img: Img,
  inventory: Inventory,
  theme: string,
  design: Design,
  issues: ValidationIssue[],
  thinking = defaultThinking,
) {
  return generateJson<Design>(
    [imagePart(img), { text: designPrompt(inventory, theme) }, { text: repairPrompt(design, issues) }],
    designSchema,
    thinking,
  );
}
