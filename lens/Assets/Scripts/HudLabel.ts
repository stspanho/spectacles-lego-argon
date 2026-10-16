/**
 * Head-locked instruction text: floats ~60 cm ahead, a little below eye line, eases toward the gaze.
 * Lines are wrapped by hand (world-space Text has no wrap width on 5.15).
 */
export class HudLabel {
  private obj: SceneObject;
  private text: Text;
  private tf: Transform;
  private first = true;
  private sub: Text;

  constructor(private cam: Camera, private distance: number = 50, private drop: number = 8) {
    this.obj = global.scene.createSceneObject("BrickHud");
    this.tf = this.obj.getTransform();
    this.text = this.obj.createComponent("Component.Text") as Text;
    this.text.text = "";
    this.text.size = 40;
    this.text.horizontalAlignment = HorizontalAlignment.Center;
    this.text.verticalAlignment = VerticalAlignment.Center;
    this.text.textFill.color = new vec4(1, 1, 1, 1);
    this.tf.setLocalScale(new vec3(0.75, 0.75, 0.75));
    const subObj = global.scene.createSceneObject("BrickHudSub");
    subObj.setParent(this.obj);
    subObj.getTransform().setLocalPosition(new vec3(0, -9, 0));
    this.sub = subObj.createComponent("Component.Text") as Text;
    this.sub.text = "";
    this.sub.size = 34;
    this.sub.horizontalAlignment = HorizontalAlignment.Center;
    this.sub.verticalAlignment = VerticalAlignment.Center;
    this.sub.textFill.color = new vec4(0.75, 0.9, 1, 1);
    try { this.text.depthTest = false; this.sub.depthTest = false; } catch (e) {}
  }

  /** Short status lines only (instructions live on the build-area sign). */
  set(main: string, sub: string = "") {
    this.text.text = HudLabel.wrap(main, 34);
    this.sub.text = HudLabel.wrap(sub, 44);
  }

  setVisible(v: boolean) { this.obj.enabled = v; }

  /** The head-locked root; children (e.g. the capture button) ride along. */
  getObject(): SceneObject { return this.obj; }

  static wrap(s: string, width: number): string {
    const words = (s || "").split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if (line.length + w.length + 1 > width && line.length > 0) { lines.push(line); line = w; }
      else line = line ? line + " " + w : w;
    }
    if (line) lines.push(line);
    return lines.join("\n");
  }

  /** Follow-cam like spectacles-lego SpeechUI: in front of the camera along its REAL forward (so it comes
   *  along when you look down at the table), offset along the camera's up, lerp/slerp at dt*10. */
  tick(dt: number) {
    const ct = this.cam.getSceneObject().getTransform();
    const camPos = ct.getWorldPosition();
    // Transform.forward is +Z = behind an LS camera; -forward is the view direction
    const target = camPos.add(ct.forward.uniformScale(-this.distance)).add(ct.up.uniformScale(this.drop));
    const k = this.first ? 1 : Math.min(1, dt * 10);
    this.first = false;
    this.tf.setWorldPosition(vec3.lerp(this.tf.getWorldPosition(), target, k));
    const desired = quat.lookAt(ct.forward, vec3.up());
    this.tf.setWorldRotation(k >= 1 ? desired : quat.slerp(this.tf.getWorldRotation(), desired, k));
  }

  destroy() { try { this.obj.destroy(); } catch (e) {} }
}
