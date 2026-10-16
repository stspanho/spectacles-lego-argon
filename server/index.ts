import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { defaultThinking, makeDesign, makeInventory, model, repairDesign, THINKING_LEVELS, type ArgonCall, type Img, type Thinking } from "./argon.ts";
import { mockDesign, mockInventory } from "./mock.ts";
import { validateDesign } from "../shared/validate.ts";
import type { Design, Inventory, Job, JobStage } from "../shared/types.ts";

// Backend for the brick builder. Client-agnostic: the web app uses it now, the Specs lens later.
// Every run is saved under runs/<id>/ (image, job.json, raw Argon calls) for replay and debugging.

const PORT = Number(process.env.PORT || 8797);
const TOKEN = process.env.ACCESS_TOKEN || "";
const MOCK = process.env.ARGON_MOCK === "1";
// ARGON_MOCK=1 MOCK_RUN=<run id>: replay that run's saved inventory + design instead of the built-in mock.
const MOCK_RUN = process.env.MOCK_RUN || "";
const MAX_REPAIRS = 3;
const RUNS = path.resolve("runs");

const jobs = new Map<string, Job>();
const images = new Map<string, Img>();

const app = express();
app.use(express.json({ limit: "30mb" }));

// Simple shared-secret check: the tunnel URL is public, the API key is not free.
app.use("/api", (req, res, next) => {
  const header = req.get("x-access-token");
  const given = String(header ?? req.query.token ?? "").trim();
  if (TOKEN && given !== TOKEN) {
    // Diagnostics only: lengths, never the values.
    console.warn(`401 ${req.method} ${req.path}: header=${header === undefined ? "missing" : header.length + " chars"} query=${req.query.token === undefined ? "missing" : "present"} ua=${req.get("user-agent") ?? "?"}`);
    return res.status(401).json({ error: "Missing or wrong access token" });
  }
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true, model, thinking: defaultThinking, mock: MOCK }));

/** Optional per-run thinking level (LOW / MEDIUM / HIGH), falls back to ARGON_THINKING. */
function thinkingParam(value: unknown): Thinking {
  const v = String(value ?? "").toUpperCase();
  return (THINKING_LEVELS as readonly string[]).includes(v) ? (v as Thinking) : defaultThinking;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post("/api/jobs", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Send the photo as multipart field 'image'" });
  if (!/^image\/(jpeg|png|webp)$/.test(req.file.mimetype))
    return res.status(400).json({ error: `Unsupported image type ${req.file.mimetype}; use JPEG, PNG or WebP` });

  const job = await startJob({ data: req.file.buffer, mimeType: req.file.mimetype }, req.body);
  res.status(202).json(job);
});

async function startJob(img: Img, body: { theme?: unknown; thinking?: unknown }): Promise<Job> {
  const id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + randomUUID().slice(0, 6);
  const job: Job = {
    id,
    stage: "queued",
    theme: String(body.theme ?? "").slice(0, 200),
    thinking: thinkingParam(body.thinking),
    createdAt: new Date().toISOString(),
    log: [],
    attempts: 0,
    imageUrl: `/api/jobs/${id}/image`,
  };
  jobs.set(id, job);
  images.set(id, img);
  await mkdir(path.join(RUNS, id), { recursive: true });
  await writeFile(path.join(RUNS, id, "image." + img.mimeType.split("/")[1]), img.data);
  run(job, img, { inventory: true });
  return job;
}

// Re-design from the same photo + inventory with a new theme (skips the inventory call).
app.post("/api/jobs/:id/redesign", async (req, res) => {
  const old = await loadJob(req.params.id);
  const img = old && (await loadImage(old.id));
  if (!old?.inventory || !img) return res.status(404).json({ error: "Job, image or inventory not found" });
  const job: Job = {
    ...old,
    stage: "queued",
    theme: String(req.body?.theme ?? old.theme).slice(0, 200),
    thinking: thinkingParam(req.body?.thinking ?? old.thinking),
    log: [...old.log],
    design: undefined,
    issues: undefined,
    attempts: 0,
    error: undefined,
  };
  jobs.set(job.id, job);
  res.status(202).json(job);
  run(job, img, { inventory: false });
});

// JSON variant for clients without multipart (the Specs lens): { image: base64, mimeType, theme, thinking }.
app.post("/api/jobs/b64", async (req, res) => {
  const { image, mimeType = "image/jpeg", theme, thinking } = req.body ?? {};
  if (typeof image !== "string" || !image) return res.status(400).json({ error: "Send { image: <base64> }" });
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return res.status(400).json({ error: `Unsupported image type ${mimeType}` });
  const img: Img = { data: Buffer.from(image, "base64"), mimeType };
  if (img.data.length > 20 * 1024 * 1024) return res.status(413).json({ error: "Image too large" });
  const job = await startJob(img, { theme, thinking });
  res.status(202).json(job);
});

app.get("/api/jobs", async (_req, res) => {
  const ids = existsSync(RUNS) ? (await readdir(RUNS)).sort().reverse().slice(0, 30) : [];
  const list = (await Promise.all(ids.map(loadJob))).filter((j): j is Job => !!j);
  res.json(list.map(({ id, stage, theme, createdAt, design }) => ({ id, stage, theme, createdAt, title: design?.title })));
});

app.get("/api/jobs/:id", async (req, res) => {
  const job = await loadJob(req.params.id);
  job ? res.json(job) : res.status(404).json({ error: "Not found" });
});

app.get("/api/jobs/:id/image", async (req, res) => {
  const img = await loadImage(req.params.id);
  if (!img) return res.status(404).end();
  res.type(img.mimeType).send(img.data);
});

// HOST=127.0.0.1 binds a local-only instance (used token-less by the Lens Studio editor loop).
app.listen(PORT, process.env.HOST || "0.0.0.0", () => {
  console.log(`Brick builder API on http://${process.env.HOST || "localhost"}:${PORT}  model=${model}${MOCK ? " (MOCK)" : ""}${TOKEN ? "" : " (NO TOKEN)"}`);
  if (!MOCK && !process.env.GEMINI_API_KEY) console.warn("⚠ GEMINI_API_KEY is empty — set it in .env or use ARGON_MOCK=1");
});

// ---------- Pipeline ----------

async function run(job: Job, img: Img, opts: { inventory: boolean }) {
  const dir = path.join(RUNS, job.id);
  const step = async (stage: JobStage, message: string) => {
    job.stage = stage;
    job.log.push({ at: new Date().toISOString(), message });
    console.log(`[${job.id}] ${message}`);
    await save(job);
  };
  const thinking = job.thinking ?? defaultThinking;
  const record = async <T,>(name: string, call: ArgonCall<T>) => {
    await writeFile(path.join(dir, `${Date.now()}-${name}.json`), JSON.stringify({ thinking, ms: call.ms, usage: call.usage, raw: call.raw }, null, 2));
    return call;
  };

  try {
    let inventory: Inventory;
    if (opts.inventory || !job.inventory) {
      await step("inventory", `Counting your bricks… (thinking ${thinking})`);
      inventory = MOCK ? (await mockData()).inventory : (await record("inventory", await makeInventory(img, thinking))).data;
      job.inventory = inventory;
      const total = inventory.items.reduce((n, i) => n + i.count, 0);
      await step("inventory", `Found ${total} pieces in ${inventory.items.length} kinds${inventory.hasBaseplate ? " + a baseplate" : ""}.`);
    } else inventory = job.inventory;

    await step("designing", `Designing${job.theme ? ` "${job.theme}"` : ""}…`);
    let design: Design = MOCK ? (await mockData()).design : (await record("design", await makeDesign(img, inventory, job.theme, thinking))).data;
    job.attempts = 1;

    for (;;) {
      await step("validating", `Checking "${design.title}" (${design.steps.length} steps) can really be built…`);
      const issues = validateDesign(design, inventory);
      job.design = design;
      job.issues = issues;
      if (issues.length === 0) break;
      if (job.attempts > MAX_REPAIRS) {
        await step("validating", `Still ${issues.length} problem(s) after ${MAX_REPAIRS} repairs — showing it anyway.`);
        break;
      }
      await step("repairing", `Found ${issues.length} problem(s), asking Argon to fix them (repair ${job.attempts}/${MAX_REPAIRS})…`);
      design = (await record(`repair${job.attempts}`, await repairDesign(img, inventory, job.theme, design, issues, thinking))).data;
      job.attempts++;
    }

    await step("done", "Ready to build!");
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    await step("error", `Failed: ${job.error}`);
  }
}

async function mockData(): Promise<{ inventory: Inventory; design: Design }> {
  if (MOCK_RUN) {
    const saved = await loadJob(MOCK_RUN);
    if (saved?.inventory && saved.design) {
      await new Promise((r) => setTimeout(r, 1500)); // a little latency so clients show their waiting state
      return { inventory: saved.inventory, design: saved.design };
    }
    console.warn(`MOCK_RUN=${MOCK_RUN} has no inventory/design, using the built-in mock`);
  }
  return { inventory: mockInventory, design: mockDesign };
}

async function save(job: Job) {
  await writeFile(path.join(RUNS, job.id, "job.json"), JSON.stringify(job, null, 2));
}

async function loadJob(id: string): Promise<Job | undefined> {
  if (!/^[\w-]+$/.test(id)) return undefined;
  const live = jobs.get(id);
  if (live) return live;
  try {
    return JSON.parse(await readFile(path.join(RUNS, id, "job.json"), "utf8")) as Job;
  } catch {
    return undefined;
  }
}

async function loadImage(id: string): Promise<Img | undefined> {
  if (!/^[\w-]+$/.test(id)) return undefined;
  const cached = images.get(id);
  if (cached) return cached;
  for (const ext of ["jpeg", "png", "webp"]) {
    const file = path.join(RUNS, id, `image.${ext}`);
    if (existsSync(file)) return { data: await readFile(file), mimeType: `image/${ext}` };
  }
  return undefined;
}
