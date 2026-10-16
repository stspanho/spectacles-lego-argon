#!/usr/bin/env python3
"""Sound design for lego-argon.mp4: a soft toy-marimba music bed + SFX at the UI clicks and reveals.
Usage: python3 sound.py events.json duration out.wav
events.json: [{"t": seconds, "kind": "shutter|click|next|reveal|place|finale|fade"}, ...]
"""
import json, math, sys, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def seconds(n):
    return np.arange(int(n * SR)) / SR


def env(n, a, d, s=0.0, r=0.0, hold=0.0):
    """ADSR-ish envelope over n samples (times in s)."""
    t = np.arange(n) / SR
    e = np.ones(n)
    e = np.where(t < a, t / max(a, 1e-4), e)
    dec = np.exp(-(t - a) / max(d, 1e-4))
    e = np.where(t >= a, s + (1 - s) * dec, e)
    if r > 0:
        tail = n - int(r * SR)
        if tail > 0:
            rt = np.arange(n - tail) / SR
            e[tail:] *= np.exp(-rt / r)
    return e


def marimba(freq, dur, vol=1.0, bright=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * freq * t) + bright * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 12) + 0.15 * np.sin(2 * np.pi * freq * 10 * t) * np.exp(-t * 30)
    return tone * np.exp(-t * (5.5 + freq / 400)) * vol


def pad_note(freq, dur, vol=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tone = np.zeros(n)
    for det, w in ((1.0, 1.0), (1.004, 0.6), (0.996, 0.6), (2.0, 0.18)):
        tone += w * np.sin(2 * np.pi * freq * det * t + rng.uniform(0, 6.28))
    tone += 0.25 * (2 * np.abs(2 * ((freq * t) % 1) - 1) - 1)  # a soft triangle under it
    return tone * env(n, 0.5, 2.0, 0.6, 0.6) * vol * 0.25


def bass_note(freq, dur, vol=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2 * t)
    return tone * env(n, 0.01, 0.6, 0.3, 0.15) * vol


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def lowpass(x, cutoff):
    """One-pole lowpass (cheap, musical)."""
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    b = 1 - a
    for i in range(len(x)):
        acc = a * acc + b * x[i]
        y[i] = acc
    return y


def lowpass_fast(x, cutoff):
    # vectorised via FFT (fine for our offline use)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(X * H, n=len(x))


def highpass_fast(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1 / np.sqrt(1 + (cutoff / np.maximum(f, 1e-3)) ** 4)
    return np.fft.irfft(X * H, n=len(x))


def bandpass_fast(x, lo, hi):
    return highpass_fast(lowpass_fast(x, hi), lo)


def reverb(x, decay=1.2, mix=0.25, pre=0.02):
    n_ir = int(decay * 3 * SR)
    t = np.arange(n_ir) / SR
    ir = rng.standard_normal(n_ir) * np.exp(-t * 3 / decay)
    ir[: int(pre * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2)) * 6
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + n_ir) * np.fft.rfft(ir, len(x) + n_ir))[: len(x)]
    wet = lowpass_fast(wet, 5000)
    return x * (1 - mix) + wet * mix


# ---------------------------------------------------------------- music
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def hz(name, octave):
    return 440.0 * 2 ** ((NOTE[name] + 12 * (octave - 4) - 9) / 12)


def music(duration, bpm=96):
    n = int(duration * SR) + SR
    out = np.zeros(n)
    beat = 60 / bpm
    bar = 4 * beat
    # C - G - Am - F, with arpeggio patterns per chord (marimba) and a pad
    chords = [
        (["C", "E", "G"], [3, 4, 4], "C"),
        (["G", "B", "D"], [3, 3, 4], "G"),
        (["A", "C", "E"], [3, 4, 4], "A"),
        (["F", "A", "C"], [3, 4, 5], "F"),
    ]
    arp_pattern = [0, 1, 2, 1, 0, 2, 1, 2]  # 8th notes
    melody_bank = [
        [("E", 5), ("G", 5), None, ("C", 6), None, None, ("G", 5), None],
        [("D", 5), None, ("G", 5), None, ("B", 5), None, None, ("A", 5)],
        [("C", 6), None, ("B", 5), ("A", 5), None, ("E", 5), None, None],
        [("F", 5), ("A", 5), None, ("C", 6), None, ("A", 5), ("G", 5), None],
    ]
    t = 0.0
    bar_i = 0
    while t < duration + bar:
        names, octs, root = chords[bar_i % 4]
        start = int(t * SR)
        # pad
        for nm, oc in zip(names, octs):
            p = pad_note(hz(nm, oc), bar + 0.8, 0.55)
            end = min(n, start + len(p))
            out[start:end] += p[: end - start]
        # bass on 1 and 3
        for b in (0, 2):
            s = start + int(b * beat * SR)
            bn = bass_note(hz(root, 2), beat * 1.6, 0.22)
            end = min(n, s + len(bn))
            if s < n:
                out[s:end] += bn[: end - s]
        # arpeggio
        for k, idx in enumerate(arp_pattern):
            s = start + int(k * beat / 2 * SR)
            m = marimba(hz(names[idx], octs[idx] + 1), 0.9, 0.16 if k % 2 == 0 else 0.11)
            end = min(n, s + len(m))
            if s < n:
                out[s:end] += m[: end - s]
        # melody every other loop, lightly
        if (bar_i // 4) % 2 == 1 or bar_i >= 12:
            for k, note in enumerate(melody_bank[bar_i % 4]):
                if not note:
                    continue
                s = start + int(k * beat / 2 * SR)
                m = marimba(hz(note[0], note[1]), 1.2, 0.2, 0.25)
                end = min(n, s + len(m))
                if s < n:
                    out[s:end] += m[: end - s]
        t += bar
        bar_i += 1
    out = out[: int(duration * SR)]
    out = reverb(out, 1.4, 0.3)
    return out


# ---------------------------------------------------------------- sfx
def sfx_click(strength=1.0):
    """A plastic button: a bright tick + a short low thock."""
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    tick = bandpass_fast(noise(0.16), 1800, 6500) * np.exp(-t * 180) * 0.9
    thock = np.sin(2 * np.pi * (170 + 90 * np.exp(-t * 60)) * t) * np.exp(-t * 28) * 0.9
    body = bandpass_fast(noise(0.16), 400, 1600) * np.exp(-t * 70) * 0.35
    return (tick + thock + body) * 0.55 * strength


def sfx_shutter():
    """Camera: two quick clicks and a soft whirr."""
    n = int(0.45 * SR)
    out = np.zeros(n)
    c1 = sfx_click(1.0)
    out[: len(c1)] += c1
    o = int(0.09 * SR)
    c2 = sfx_click(0.8)
    out[o : o + len(c2)] += c2
    t = np.arange(n) / SR
    whirr = bandpass_fast(noise(0.45), 2500, 4500) * np.exp(-t * 9) * 0.12 * (1 + 0.5 * np.sin(2 * np.pi * 55 * t))
    out += whirr
    return out


def sfx_pop():
    """A tiny 'brick settles' pop used after NEXT (the new step drops in)."""
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    blip = np.sin(2 * np.pi * (520 - 200 * t / 0.18) * t) * np.exp(-t * 35) * 0.3
    tick = bandpass_fast(noise(0.18), 2000, 7000) * np.exp(-t * 220) * 0.25
    return blip + tick


def sfx_reveal(scale=1.0, notes=(("C", 5), ("E", 5), ("G", 5), ("C", 6), ("E", 6)), gap=0.07):
    """Ascending marimba sparkle + shimmer."""
    dur = gap * len(notes) + 1.6
    n = int(dur * SR)
    out = np.zeros(n)
    for i, (nm, oc) in enumerate(notes):
        s = int(i * gap * SR)
        m = marimba(hz(nm, oc), 1.4, 0.5, 0.4)
        out[s : s + len(m)] += m[: n - s]
    t = np.arange(n) / SR
    shimmer = np.sin(2 * np.pi * 2093 * t + 3 * np.sin(2 * np.pi * 6 * t)) * np.exp(-t * 2.2) * 0.07
    shimmer += bandpass_fast(noise(dur), 5000, 11000) * np.exp(-t * 4) * 0.08
    return (out + shimmer) * scale


def sfx_place():
    """Build area lands: a short whoosh swelling into a warm chord."""
    dur = 2.2
    n = int(dur * SR)
    t = np.arange(n) / SR
    sw = bandpass_fast(noise(dur), 300, 2500) * np.where(t < 0.35, (t / 0.35) ** 2, np.exp(-(t - 0.35) * 9)) * 0.3
    chord = np.zeros(n)
    for nm, oc in (("C", 4), ("E", 4), ("G", 4), ("C", 5)):
        s = int(0.3 * SR)
        m = marimba(hz(nm, oc), 1.8, 0.35, 0.3)
        chord[s : s + len(m)] += m[: n - s]
    thud = np.sin(2 * np.pi * (90 + 40 * np.exp(-t * 20)) * (t - 0.3)) * np.where(t >= 0.3, np.exp(-(t - 0.3) * 12), 0) * 0.35
    return sw + chord + thud


def sfx_finale():
    """Finished: a bright run up, a held chord and a sparkle burst."""
    run = sfx_reveal(1.0, (("C", 5), ("E", 5), ("G", 5), ("C", 6), ("E", 6), ("G", 6), ("C", 7)), 0.065)
    dur = 3.2
    n = int(dur * SR)
    out = np.zeros(n)
    out[: len(run)] += run[:n]
    for nm, oc in (("C", 4), ("E", 4), ("G", 4), ("C", 5), ("E", 5)):
        s = int(0.4 * SR)
        p = pad_note(hz(nm, oc), 2.6, 0.7)
        out[s : s + len(p)] += p[: n - s]
    t = np.arange(n) / SR
    sparkle = bandpass_fast(noise(dur), 4000, 12000) * np.exp(-t * 2.5) * 0.12 * (0.6 + 0.4 * np.sin(2 * np.pi * 11 * t))
    return out + sparkle


def sfx_fade():
    """The hologram dissolves: a soft airy wash sinking away."""
    dur = 1.8
    n = int(dur * SR)
    t = np.arange(n) / SR
    wash = bandpass_fast(noise(dur), 1500, 6000) * np.exp(-t * 2.5) * 0.12
    glide = np.sin(2 * np.pi * (660 * np.exp(-t * 0.9)) * t) * np.exp(-t * 2.0) * 0.07
    return wash + glide


SFX = {
    "shutter": sfx_shutter,
    "click": lambda: sfx_click(1.0),
    "next": lambda: sfx_click(0.9),
    "pop": sfx_pop,
    "reveal": lambda: sfx_reveal(0.9),
    "place": sfx_place,
    "finale": sfx_finale,
    "fade": sfx_fade,
}


def main():
    events = json.load(open(sys.argv[1]))
    duration = float(sys.argv[2])
    out_path = sys.argv[3]
    n = int(duration * SR)
    bed = music(duration)
    # music level: well under the SFX; fade in / out with the picture
    bed *= 0.9 / (np.max(np.abs(bed)) + 1e-9)
    t = np.arange(n) / SR
    bed *= np.minimum(1, t / 1.2) * np.minimum(1, (duration - t) / 2.5)
    bed *= 0.42
    fx = np.zeros(n)
    for ev in events:
        s = int(ev["t"] * SR)
        snd = SFX[ev["kind"]]() * ev.get("gain", 1.0)
        if ev["kind"] == "next":  # the step's pieces drop in a beat later
            pop = sfx_pop()
            o = s + int(0.28 * SR)
            if o < n:
                fx[o : o + len(pop)] += pop[: n - o]
        if s < n:
            fx[s : s + len(snd)] += snd[: n - s]
    fx = reverb(fx, 0.9, 0.18)
    fx *= 0.9 / (np.max(np.abs(fx)) + 1e-9)
    # duck the bed a little under the big reveals
    duck = np.ones(n)
    for ev in events:
        if ev["kind"] in ("place", "finale", "reveal"):
            s = int(ev["t"] * SR)
            L = int(2.0 * SR)
            k = np.arange(min(L, n - s)) / SR
            duck[s : s + len(k)] *= 1 - 0.35 * np.exp(-k * 1.2)
    mix = bed * duck + fx
    # gentle limiter
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    mix *= 0.89 / (np.max(np.abs(mix)) + 1e-9)
    # stereo: a hair of width via a tiny delay on the right
    right = np.concatenate([np.zeros(12), mix[:-12]])
    stereo = np.stack([mix, 0.5 * mix + 0.5 * right], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wrote", out_path, "events", len(events), "peak bed", float(np.max(np.abs(bed))), "peak fx", float(np.max(np.abs(fx))))


if __name__ == "__main__":
    main()
