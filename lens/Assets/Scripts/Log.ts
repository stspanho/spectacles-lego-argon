/** print()-based logger: everything lands in the Logger panel / RunAndCollectLogs prints (SIK's NativeLogger hides info lines by default). */
export interface Log {
  d(m: string): void;
  i(m: string): void;
  w(m: string): void;
  e(m: string): void;
}

export function makeLog(tag: string): Log {
  const p = (lvl: string, m: string) => print("[" + tag + "]" + (lvl ? " " + lvl : "") + " " + m);
  return { d: (m) => p("", m), i: (m) => p("", m), w: (m) => p("WARN", m), e: (m) => p("ERROR", m) };
}
