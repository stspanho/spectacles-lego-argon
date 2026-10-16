import { makeLog } from "./Log";
import { worldCameraId } from "./WorldCamera";

const log = makeLog("SurfaceProjector");

/**
 * Image point -> table point. Argon only gives 2D boxes on the photo; we cast the camera ray through the
 * frozen pose + intrinsics and intersect the calibrated horizontal plane (spectacles-lego
 * CameraSurfaceProjector). The POSE IS FROZEN AT CAPTURE: the answer comes back a minute later and the
 * head has moved by then.
 */
class Snapshot {
  constructor(
    public texture: Texture,
    public camWorld: mat4,
    public deviceCamera: DeviceCamera | null,
    public fov: number,
    public aspect: number,
  ) {}
}

export class SurfaceProjector {
  private frames: { [id: number]: Snapshot } = {};
  private counter = 0;

  constructor(private getCamera: () => Camera | null, private getSurfaceY: () => number | null) {}

  /** Freeze the current frame + pose. -1 if the camera is not ready. */
  freeze(tex: Texture | null): number {
    const cam = this.getCamera();
    if (!tex || !cam) return -1;
    if (tex.getWidth() < 2) return -1;
    let frozen: Texture = tex;
    try { const c = tex.copyFrame(); if (c) frozen = c; } catch (e) {}
    const camWorld = cam.getSceneObject().getTransform().getWorldTransform();
    let dc: DeviceCamera | null = null;
    try { if (!global.deviceInfoSystem.isEditor()) dc = global.deviceInfoSystem.getTrackingCameraForId(worldCameraId()); } catch (e) {}
    const id = ++this.counter;
    this.frames[id] = new Snapshot(frozen, camWorld, dc, cam.fov, cam.aspect);
    log.i("frozen frame " + id + " " + frozen.getWidth() + "x" + frozen.getHeight() + (dc ? " (device intrinsics)" : " (pinhole)"));
    return id;
  }

  texture(id: number): Texture | null {
    const f = this.frames[id];
    return f ? f.texture : null;
  }

  /** Camera position at capture. */
  cameraPos(id: number): vec3 | null {
    const f = this.frames[id];
    return f ? f.camWorld.multiplyPoint(vec3.zero()) : null;
  }

  /** Camera forward (world) at capture. */
  cameraForward(id: number): vec3 | null {
    const f = this.frames[id];
    return f ? f.camWorld.multiplyDirection(new vec3(0, 0, -1)).normalize() : null;
  }

  /** Calibrated table height (world Y, cm) or null. */
  surfaceY(): number | null { return this.getSurfaceY(); }

  /** (u, v) normalised image coords, v DOWN from the top-left -> point on the surface plane, or null. */
  toSurface(id: number, u: number, v: number): vec3 | null {
    const surfaceY = this.getSurfaceY();
    if (surfaceY === null) return null;
    return this.toPlane(id, u, v, surfaceY);
  }

  /** Same, but against a horizontal plane at world height `planeY` (e.g. a brick's mid-height). */
  toPlane(id: number, u: number, v: number, planeY: number): vec3 | null {
    const f = this.frames[id];
    if (!f) return null;
    const surfaceY = planeY;
    let near: vec3, dir: vec3;
    if (f.deviceCamera) {
      const uv = new vec2(u, v);
      near = f.camWorld.multiplyPoint(f.deviceCamera.unproject(uv, 10));
      const far = f.camWorld.multiplyPoint(f.deviceCamera.unproject(uv, 200));
      dir = far.sub(near);
    } else {
      const tanV = Math.tan(f.fov / 2); // Camera.fov is vertical, radians
      const tanH = tanV * f.aspect;
      near = f.camWorld.multiplyPoint(vec3.zero());
      dir = f.camWorld.multiplyDirection(new vec3((u * 2 - 1) * tanH, (1 - v * 2) * tanV, -1));
    }
    if (Math.abs(dir.y) < 1e-5) return null;
    const t = (surfaceY - near.y) / dir.y;
    if (t < 0) return null;
    return near.add(dir.uniformScale(t));
  }

  dispose(id: number) {
    delete this.frames[id];
  }
}
