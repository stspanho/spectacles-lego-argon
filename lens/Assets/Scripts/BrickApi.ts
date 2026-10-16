import { makeLog } from "./Log";
import { Job } from "./BrickTypes";

const log = makeLog("BrickApi");

/** Client for the brick-builder backend (laptop, reached through the Cloudflare tunnel). */
export class BrickApi {
  private net: InternetModule = require("LensStudio:InternetModule");

  constructor(private host: BaseScriptComponent, private base: string, private token: string) {
    this.base = base.replace(/\/+$/, "");
    this.token = (token || "").trim();
  }

  tokenLength(): number { return this.token.length; }

  /** One request. Built as `new Request(url, init)` — the form spectacles-lego uses on device (the
   *  (url, init) overload gave status 0 on Spectacles). Status 0 = transport failure: retried once. */
  private async request(path: string, method: string, body?: object, attempt: number = 0): Promise<any> {
    // token both as a header and as ?token= (the backend accepts either; belt and braces for the device HTTP stack)
    const url = this.base + path + (this.token ? (path.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(this.token) : "");
    const headers: any = { "x-access-token": this.token, Accept: "application/json" };
    const init: any = { method, headers };
    if (body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const t0 = getTime();
    let res: any = null;
    try {
      res = await this.net.fetch(new Request(url, init));
    } catch (e) {
      log.w(method + " " + path + " threw: " + e);
    }
    const status = res ? res.status : 0;
    if (status === 0 && attempt < 1) {
      log.w(method + " " + path + " status 0 (no response) — retrying in 1.5 s; body " + (init.body ? Math.round(init.body.length / 1024) + " KB" : "none"));
      await new Promise<void>((resolve) => {
        const ev = this.host.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
        ev.bind(() => resolve());
        ev.reset(1.5);
      });
      return this.request(path, method, body, attempt + 1);
    }
    if (!res) throw new Error("no response (status 0) from " + url);
    const text: string = await res.text();
    if (!res.ok) throw new Error("HTTP " + res.status + " " + text.slice(0, 160));
    log.d(method + " " + path + " " + res.status + " " + (getTime() - t0).toFixed(2) + "s" + (res.status === 401 ? " (token " + this.token.length + " chars)" : ""));
    return JSON.parse(text);
  }

  health(): Promise<{ ok: boolean; model: string; mock: boolean; thinking: string }> {
    return this.request("/api/health", "GET");
  }

  createJob(image64: string, mimeType: string, theme: string, thinking: string): Promise<Job> {
    return this.request("/api/jobs/b64", "POST", { image: image64, mimeType, theme, thinking });
  }

  getJob(id: string): Promise<Job> {
    return this.request("/api/jobs/" + id, "GET");
  }
}
