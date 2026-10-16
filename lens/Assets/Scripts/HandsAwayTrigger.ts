import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";
import { makeLog } from "./Log";

const log = makeLog("HandsAway");

/**
 * "You worked at the build, then pulled your hands back" detector.
 *   WAIT     a hand enters the build zone (model footprint + margin, up to `zoneHeight` above the table)
 *   BUSY     while either hand is inside
 *   SETTLE   both hands out (or untracked) for `awaySeconds`, the user looks at the build and the head is
 *            still -> fire. A hand coming back resets the timer; the zone must be entered again before the
 *            next firing (reaching into the pile or dropping the hands in your lap never fires).
 * Also exposes a debounced pinch (either hand) as a manual "next".
 */
export class HandsAwayTrigger {
  public awaySeconds = 1.5;
  public margin = 10; // cm around the footprint
  public zoneHeight = 30; // cm above the table
  public onFire: (() => void) | null = null;
  public onPinch: (() => void) | null = null;

  private enabled = false;
  private centre: vec3 = vec3.zero();
  private half: vec3 = new vec3(10, 15, 10);
  private armed = false;
  private awaySince = -1;
  private lastHeadPos: vec3 | null = null;
  private headStillSince = 0;
  private pinchWas = false;
  private lastPinchAt = -10;
  private hands: any[] = [];

  constructor(private cam: Camera) {}

  /** Call from OnStartEvent (SIK providers must exist). */
  init() {
    try {
      const input: any = SIK.HandInputData;
      this.hands = [input.getHand("left"), input.getHand("right")];
    } catch (e) {
      log.w("no hand input: " + e);
    }
  }

  /** Axis-aligned zone (world) over the build footprint. */
  setZone(centre: vec3, lx: number, lz: number) {
    this.centre = new vec3(centre.x, centre.y + this.zoneHeight / 2, centre.z);
    this.half = new vec3(lx / 2 + this.margin, this.zoneHeight / 2, lz / 2 + this.margin);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.armed = false;
    this.awaySince = -1;
  }

  isArmed(): boolean { return this.armed; }

  private handPoint(h: any): vec3 | null {
    try {
      if (!h || !h.isTracked()) return null;
      const p = h.getPalmCenter ? h.getPalmCenter() : null;
      if (p) return p;
      return h.indexTip ? h.indexTip.position : null;
    } catch (e) { return null; }
  }

  private inZone(p: vec3): boolean {
    return Math.abs(p.x - this.centre.x) <= this.half.x && Math.abs(p.y - this.centre.y) <= this.half.y && Math.abs(p.z - this.centre.z) <= this.half.z;
  }

  tick(now: number) {
    // manual pinch, any time while enabled
    let pinching = false;
    for (const h of this.hands) { try { if (h && h.isTracked() && h.isPinching()) pinching = true; } catch (e) {} }
    if (pinching && !this.pinchWas && now - this.lastPinchAt > 0.8 && this.enabled) {
      this.lastPinchAt = now;
      if (this.onPinch) this.onPinch();
    }
    this.pinchWas = pinching;

    if (!this.enabled) return;
    let near = false;
    for (const h of this.hands) {
      const p = this.handPoint(h);
      if (p && this.inZone(p)) { near = true; break; }
    }
    if (near) {
      if (!this.armed) log.d("hand entered the build zone");
      this.armed = true;
      this.awaySince = -1;
      return;
    }
    if (!this.armed) return;
    if (this.awaySince < 0) this.awaySince = now;
    if (now - this.awaySince < this.awaySeconds) return;
    if (!this.lookingAtBuild() || !this.headStill(now)) return;
    this.armed = false;
    this.awaySince = -1;
    log.i("hands away for " + this.awaySeconds + "s -> fire");
    if (this.onFire) this.onFire();
  }

  private lookingAtBuild(): boolean {
    const ct = this.cam.getSceneObject().getTransform();
    const to = this.centre.sub(ct.getWorldPosition());
    if (to.length < 1e-3) return true;
    return to.normalize().dot(ct.back) > 0.75;
  }

  private headStill(now: number): boolean {
    const p = this.cam.getSceneObject().getTransform().getWorldPosition();
    if (this.lastHeadPos && p.distance(this.lastHeadPos) > 0.6) this.headStillSince = now;
    this.lastHeadPos = p;
    return now - this.headStillSince > 0.3;
  }
}
