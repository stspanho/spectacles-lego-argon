import { makeLog } from "./Log";

const log = makeLog("WorldCamera");

/**
 * The device's world (colour) camera, resolved ONCE and shared: the same camera id must feed both the
 * texture we photograph and `getTrackingCameraForId` (intrinsics + pose), or every projected position is
 * offset. A real Spectacles unit refused Left_Color outright, so candidates are tried in order
 * (pattern from spectacles-lego WorldCameraId/CameraService).
 *
 * The CameraModule must come from an @input binding — that is what declares the Camera capability.
 */

let resolvedId: any = null;
let resolvedName = "";

function candidateNames(): string[] {
  let isEditor = false;
  try { isEditor = global.deviceInfoSystem.isEditor(); } catch (e) {}
  if (isEditor) return ["Default_Color"];
  return ["Default_Color", "Right_Color", "Left_Color", "Left_Grayscale", "Right_Grayscale"];
}

function idFor(name: string): any {
  const M: any = CameraModule;
  try { return M && M.CameraId ? M.CameraId[name] : undefined; } catch (e) { return undefined; }
}

/** The id to use for intrinsics / pose (whatever camera the stream came from). */
export function worldCameraId(): any {
  if (resolvedId !== null) return resolvedId;
  for (const name of candidateNames()) {
    const id = idFor(name);
    if (id === undefined) continue;
    try {
      if (global.deviceInfoSystem.getTrackingCameraForId(id)) { resolvedId = id; resolvedName = name; return id; }
    } catch (e) {}
  }
  return idFor(candidateNames()[0]);
}

export class WorldCamera {
  public texture: Texture | null = null;
  private ready = false;
  private frames = 0;
  public onReady: (() => void) | null = null;

  constructor(camModule: CameraModule) {
    if (!camModule) { log.e("cameraModule @input is not wired"); return; }
    for (const name of candidateNames()) {
      const id = idFor(name);
      if (id === undefined) continue;
      try {
        const req = CameraModule.createCameraRequest();
        req.cameraId = id;
        const tex = camModule.requestCamera(req);
        if (!tex) continue;
        this.texture = tex;
        resolvedId = id;
        resolvedName = name;
        log.i("using " + name);
        break;
      } catch (e) {
        log.w(name + " refused: " + e);
      }
    }
    if (!this.texture) { log.e("no world camera available"); return; }
    const ctrl: any = (this.texture as any).control;
    if (ctrl && ctrl.onNewFrame && ctrl.onNewFrame.add) {
      ctrl.onNewFrame.add(() => this.onFrame());
    } else {
      log.w("camera texture has no onNewFrame; assuming ready");
      this.ready = true;
    }
  }

  private onFrame() {
    this.frames++;
    if (this.ready || !this.texture) return;
    const w = this.texture.getWidth(), h = this.texture.getHeight();
    if (w > 0 && h > 0) {
      this.ready = true;
      log.i("ready " + w + "x" + h + " (" + resolvedName + ")");
      if (this.onReady) this.onReady();
    }
  }

  isReady(): boolean { return this.ready; }
  getTexture(): Texture | null { return this.ready ? this.texture : null; }
}
