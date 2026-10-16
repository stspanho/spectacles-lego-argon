import { useEffect, useState } from "react";
import type { Job } from "../shared/types.ts";
import { api, prepareImage, type JobSummary } from "./api.ts";
import { BuildScene } from "./components/BuildScene.tsx";
import { PhotoPanel } from "./components/PhotoPanel.tsx";

const THEMES = ["surprise me", "animal", "vehicle", "house", "robot", "dragon"];

export function App() {
  const [jobId, setJobId] = useState<string | null>(() => new URLSearchParams(location.search).get("job"));

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.delete("token");
    jobId ? url.searchParams.set("job", jobId) : url.searchParams.delete("job");
    history.replaceState(null, "", url);
  }, [jobId]);

  return (
    <div className="app">
      <header>
        <button className="logo" onClick={() => setJobId(null)}>🧱 Brick Builder</button>
        <Health />
      </header>
      {jobId ? <JobView id={jobId} onOpen={setJobId} /> : <Start onStarted={setJobId} />}
    </div>
  );
}

function Health() {
  const [info, setInfo] = useState<string>("…");
  useEffect(() => {
    api.health().then((h) => setInfo(h.mock ? `${h.model} (mock)` : h.model), (e) => setInfo(`⚠ ${e.message}`));
  }, []);
  return <span className="health">{info}</span>;
}

function Start({ onStarted }: { onStarted: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [theme, setTheme] = useState(THEMES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<JobSummary[]>([]);

  useEffect(() => {
    api.jobs().then(setPast, () => {});
  }, []);

  const pick = (f: File | null) => {
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const start = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api.create(await prepareImage(file), theme === "surprise me" ? "" : theme);
      onStarted(job.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="start">
      <h1>Photo your bricks.<br />Get something cool to build.</h1>
      <p className="hint">Spread the pieces out flat so each one is visible. A baseplate in the photo helps.</p>

      <label className="drop">
        {preview ? <img src={preview} alt="" /> : <span>📷 Take or choose a photo</span>}
        <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>

      <div className="chips">
        {THEMES.map((t) => (
          <button key={t} className={t === theme ? "chip on" : "chip"} onClick={() => setTheme(t)}>{t}</button>
        ))}
      </div>
      <input className="theme" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="or type a theme…" />

      <button className="primary" disabled={!file || busy} onClick={start}>{busy ? "Uploading…" : "Design my build"}</button>
      {error && <p className="error">{error}</p>}

      {past.length > 0 && (
        <section className="past">
          <h2>Earlier runs</h2>
          {past.map((j) => (
            <button key={j.id} onClick={() => onStarted(j.id)}>
              <b>{j.title ?? j.theme ?? "untitled"}</b>
              <small>{new Date(j.createdAt).toLocaleString()} · {j.stage}</small>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}

function JobView({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(-1);
  const [replay, setReplay] = useState(0);
  const [theme, setTheme] = useState("");
  const [pollKey, setPollKey] = useState(0);

  // Poll until the pipeline finishes. Polling (not SSE) so a Specs lens can use the same API.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await api.job(id);
        if (stop) return;
        setJob(j);
        if (j.stage !== "done" && j.stage !== "error") timer = setTimeout(tick, 1500);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, pollKey]);

  if (error) return <main className="job"><p className="error">{error}</p></main>;
  if (!job) return <main className="job"><p>Loading…</p></main>;

  const running = job.stage !== "done" && job.stage !== "error";
  const steps = job.design?.steps ?? [];
  const go = (s: number) => {
    setStep(s);
    setReplay((r) => r + 1);
  };
  const redesign = async () => {
    const j = await api.redesign(job.id, theme);
    setJob(j);
    setStep(-1);
    setPollKey((k) => k + 1);
  };

  return (
    <main className="job">
      {(running || !job.design) && (
        <section className="progress">
          {running && <div className="spinner" />}
          <ol>
            {job.log.map((l, i) => <li key={i}>{l.message}</li>)}
          </ol>
          {job.error && <p className="error">{job.error}</p>}
        </section>
      )}

      {job.design && job.inventory && (
        <>
          <section className="title">
            <h1>{job.design.title}</h1>
            <p>{job.design.description}</p>
            {job.issues && job.issues.length > 0 && (
              <details className="warn">
                <summary>⚠ {job.issues.length} build-check problem(s) left</summary>
                <ul>{job.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
              </details>
            )}
          </section>

          <section className="viewer">
            <BuildScene design={job.design} inventory={job.inventory} step={step} replay={replay} />
            <div className="stepbar">
              {step < 0 ? (
                <>
                  <p className="instruction">✨ The finished model — {steps.length} steps, {steps.reduce((n, s) => n + s.bricks.length, 0)} pieces.</p>
                  <button className="primary" onClick={() => go(0)}>Start building</button>
                </>
              ) : (
                <>
                  <p className="count">Step {step + 1} / {steps.length}</p>
                  <p className="instruction">{steps[step].instruction}</p>
                  <div className="nav">
                    <button onClick={() => go(step - 1)} disabled={step === 0}>◀</button>
                    <button onClick={() => setReplay((r) => r + 1)}>↻ Replay</button>
                    {step < steps.length - 1 ? (
                      <button className="primary" onClick={() => go(step + 1)}>Next ▶</button>
                    ) : (
                      <button className="primary" onClick={() => go(-1)}>Done 🎉</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          {step < 0 && job.design.finale && <p className="finale">🪄 In AR: {job.design.finale}</p>}

          <section>
            <h2>{step < 0 ? "What Argon found" : "Pick these pieces"}</h2>
            <PhotoPanel src={api.imageUrl(job)} inventory={job.inventory} design={job.design} step={step} />
            {step < 0 && (
              <ul className="inventory">
                {job.inventory.items.map((i) => (
                  <li key={i.id}><i style={{ background: i.hex }} />{i.count}× {i.color} {i.description}</li>
                ))}
              </ul>
            )}
            {job.inventory.notes && step < 0 && <p className="hint">{job.inventory.notes}</p>}
          </section>

          {!running && (
            <section className="again">
              <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Try another theme with the same bricks…" />
              <button onClick={redesign} disabled={!theme.trim()}>Redesign</button>
              <button onClick={() => onOpen("")}>New photo</button>
            </section>
          )}

          <details className="debug">
            <summary>Log ({job.attempts} design attempt{job.attempts === 1 ? "" : "s"})</summary>
            <ol>{job.log.map((l, i) => <li key={i}><small>{new Date(l.at).toLocaleTimeString()}</small> {l.message}</li>)}</ol>
          </details>
        </>
      )}
    </main>
  );
}
