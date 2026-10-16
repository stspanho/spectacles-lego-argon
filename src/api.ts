import type { Job } from "../shared/types.ts";

// The access token arrives once as ?token=… and is remembered on this device.
const TOKEN_KEY = "brick-builder-token";
function token(): string {
  const fromUrl = new URLSearchParams(location.search).get("token");
  try {
    if (fromUrl) localStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl ?? localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return fromUrl ?? "";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...init.headers, "x-access-token": token() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export interface JobSummary {
  id: string;
  stage: Job["stage"];
  theme: string;
  createdAt: string;
  title?: string;
}

export const api = {
  health: () => call<{ ok: boolean; model: string; mock: boolean }>("/api/health"),
  jobs: () => call<JobSummary[]>("/api/jobs"),
  job: (id: string) => call<Job>(`/api/jobs/${id}`),
  create: (image: Blob, theme: string) => {
    const form = new FormData();
    form.append("image", image, "bricks.jpg");
    form.append("theme", theme);
    return call<Job>("/api/jobs", { method: "POST", body: form });
  },
  redesign: (id: string, theme: string) =>
    call<Job>(`/api/jobs/${id}/redesign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme }),
    }),
  imageUrl: (job: Job) => `${job.imageUrl}?token=${encodeURIComponent(token())}`,
};

/** Downscale a phone photo to ≤ 2048 px JPEG (also converts HEIC where the browser can decode it). */
export async function prepareImage(file: File, maxSide = 2048): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", 0.9),
  );
}
