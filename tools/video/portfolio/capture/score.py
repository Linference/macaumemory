"""為兩部 30 秒口述記憶短片「用程式作曲」：鋼琴、弦樂墊、低頻、殘響與場景音效全部由 numpy 合成，
沒有任何素材庫或版權音樂。和弦與音效時間點對齊 Shorts.tsx 的分鏡（由 vo30.json 旁白長度推算）。

用法：python tools/video/portfolio/capture/score.py
輸出：public/oral/score-lcv.wav、public/oral/score-kaho.wav
說明：本檔由 AI 程式助手（Claude）協助撰寫。
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SR = 48000
FPS, LEAD, TAIL, INTRO, END = 30, 3, 5, 24, 40
VO = json.loads((ROOT / "src/oral/vo30.json").read_text(encoding="utf-8"))
RNG = np.random.default_rng(7)


def plan(ids):
    at, out = 0, []
    for i, k in enumerate(ids):
        lead = LEAD + (INTRO if i == 0 else 0)
        dur = lead + round(VO[k]["seconds"] * FPS) + TAIL
        out.append({"id": k, "t0": at / FPS, "t1": (at + dur) / FPS, "vo": (at + lead) / FPS, "vf": VO[k]["seconds"]})
        at += dur
    return out, (at + END) / FPS


NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}
def hz(name: str) -> float:
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[n] + 12 * (o + 1) - 69) / 12)


def lp(x, fc, order=2):
    return sosfilt(butter(order, fc / (SR / 2), "low", output="sos"), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc / (SR / 2), "high", output="sos"), x)


def adsr(n, a, r, sustain=1.0):
    t = np.arange(n) / SR
    env = np.minimum(1, t / max(a, 1e-3)) * sustain
    rel = int(r * SR)
    if rel and rel < n:
        env[-rel:] *= np.linspace(1, 0, rel) ** 1.5
    return env


def piano(f, dur, vel=0.5):
    """鋼琴：帶輕微非諧性的泛音，各泛音按頻率衰減，加一點槌擊噪聲"""
    n = int((dur + 2.5) * SR); t = np.arange(n) / SR
    out = np.zeros(n); B = 0.00035
    for h in range(1, 11):
        fh = h * f * np.sqrt(1 + B * h * h)
        if fh > 16000: break
        out += (1 / h ** 1.15) * np.sin(2 * np.pi * fh * t + RNG.random() * 6) * np.exp(-t * (0.9 + 0.55 * h + f / 700))
    out *= np.minimum(1, t / 0.004)
    ham = lp(RNG.standard_normal(int(0.02 * SR)) * np.exp(-np.arange(int(0.02 * SR)) / (0.004 * SR)), 3000) * 0.15
    out[: len(ham)] += ham
    return out * vel * 0.35


def strings(freqs, dur, a=1.6, r=2.2, bright=1800, amp=0.12):
    """弦樂墊：每個和弦音三條略為走音的鋸齒（加法合成），慢起慢收、輕顫音，左右分開"""
    n = int((dur + r) * SR); t = np.arange(n) / SR
    L = np.zeros(n); R = np.zeros(n)
    vib = 0.0025 * np.sin(2 * np.pi * 5.2 * t)
    for j, f in enumerate(freqs):
        for d, pan in ((-0.07, 0.2), (0.0, 0.5), (0.08, 0.8)):
            ff = f * 2 ** (d / 12)
            ph = 2 * np.pi * ff * np.cumsum(1 + vib) / SR
            s = sum((1 / h) * np.sin(h * ph + j) for h in range(1, 9) if h * ff < 9000)
            L += s * (1 - pan); R += s * pan
    env = adsr(n, a, r) * amp / max(1, len(freqs))
    return lp(L * env, bright), lp(R * env, bright)


def sub(f, dur, amp=0.18):
    n = int(dur * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t) * adsr(n, 1.2, 1.5) * amp


def noise_bed(dur, kind="sea", amp=0.25):
    n = int(dur * SR); t = np.arange(n) / SR
    x = RNG.standard_normal(n)
    if kind == "sea":
        x = lp(np.cumsum(x) / 60, 900); x = hp(x, 70)
        x *= 0.55 + 0.45 * np.sin(2 * np.pi * 0.11 * t + 1) * np.sin(2 * np.pi * 0.07 * t)
    elif kind == "wind":
        x = lp(x, 500) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.05 * t))
    x /= np.max(np.abs(x)) + 1e-9
    return x * amp * adsr(n, 1.0, 1.5)


def crackle(dur, amp=0.25):
    n = int(dur * SR); x = np.zeros(n)
    for i in RNG.integers(0, n, int(dur * 26)):
        L = int(SR * (0.002 + RNG.random() * 0.006))
        if i + L < n: x[i:i + L] += RNG.standard_normal(L) * np.exp(-np.arange(L) / (L / 4)) * RNG.random()
    return hp(x, 1500) * amp


def bell(f, amp=0.25, dur=3.0):
    n = int(dur * SR); t = np.arange(n) / SR
    parts = [(1, 1), (2.76, 0.5), (5.4, 0.25), (8.93, 0.12)]
    return sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (1.2 + k * 0.6)) for k, a in parts) * amp * np.minimum(1, t / 0.002)


def thud(amp=0.4):
    n = int(0.5 * SR); t = np.arange(n) / SR
    f = 90 * np.exp(-t * 6) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * amp + lp(RNG.standard_normal(n), 400) * np.exp(-t * 30) * amp * 0.4


def boom(amp=0.7):
    n = int(3 * SR); t = np.arange(n) / SR
    f = 70 * np.exp(-t * 1.4) + 30
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.3) * amp


def tick(amp=0.12):
    n = int(0.03 * SR)
    return hp(RNG.standard_normal(n), 3000) * np.exp(-np.arange(n) / (0.003 * SR)) * amp


def reverb_ir(t60=3.2, n_s=3.6):
    n = int(n_s * SR); t = np.arange(n) / SR
    env = np.exp(-6.9 * t / t60)
    irL = lp(RNG.standard_normal(n), 6500) * env; irR = lp(RNG.standard_normal(n), 6500) * env
    for d, g in ((0.011, 0.5), (0.019, 0.35), (0.027, 0.28)):
        irL[int(d * SR)] += g; irR[int((d + 0.003) * SR)] += g
    return irL / np.abs(irL).sum() * 40, irR / np.abs(irR).sum() * 40


class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR
        self.dry = np.zeros((2, self.n)); self.wet = np.zeros((2, self.n))

    def add(self, sig, t, pan=0.5, wet=0.5, gain=1.0):
        if isinstance(sig, tuple): L, R = sig
        else: L, R = sig * (1 - pan) * 2 ** 0.5, sig * pan * 2 ** 0.5
        i = int(t * SR); m = min(len(L), self.n - i)
        if m <= 0: return
        self.dry[0, i:i + m] += L[:m] * gain * (1 - wet); self.dry[1, i:i + m] += R[:m] * gain * (1 - wet)
        self.wet[0, i:i + m] += L[:m] * gain * wet; self.wet[1, i:i + m] += R[:m] * gain * wet

    def render(self, seconds, path):
        irL, irR = reverb_ir()
        out = self.dry + np.stack([fftconvolve(self.wet[0], irL)[: self.n], fftconvolve(self.wet[1], irR)[: self.n]])
        out = out[:, : int(seconds * SR)]
        fade = int(1.2 * SR); out[:, -fade:] *= np.linspace(1, 0, fade); out[:, : int(0.3 * SR)] *= np.linspace(0, 1, int(0.3 * SR))
        out = np.tanh(out / (np.max(np.abs(out)) + 1e-9) * 1.3) * 0.82
        pcm = (out.T * 32767).astype(np.int16)
        with wave.open(str(path), "wb") as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        print("wrote", path.name, f"{seconds:.1f}s")


def arp(m: Mix, chord, t0, t1, step=0.46, vel=0.42, pattern=(0, 2, 1, 3, 2, 1), oct_up=False):
    """在 t0–t1 之間以固定步距彈分解和弦，第一拍稍重；可升八度做明亮版"""
    t, k = t0, 0
    while t < t1 - 0.2:
        f = hz(chord[pattern[k % len(pattern)] % len(chord)]) * (2 if oct_up else 1)
        m.add(piano(f, 1.2, vel * (1.25 if k % len(pattern) == 0 else 1) * (0.9 + 0.2 * RNG.random())), t + RNG.random() * 0.012, pan=0.35 + 0.3 * RNG.random(), wet=0.45)
        t += step; k += 1


def chord_at(m: Mix, names, t0, t1, amp=0.12, bright=1800):
    L, R = strings([hz(n) for n in names], t1 - t0 + 0.6, amp=amp, bright=bright)
    m.add((L, R), t0, wet=0.55)


def lcv():
    beats, total = plan(["l1", "l2", "l3", "l4", "l5", "l6"])
    b = {x["id"]: x for x in beats}
    m = Mix(total)
    # l1 1972 初到：A 小調加九，清晨海面
    chord_at(m, ["A2", "E3", "B3", "C4"], 0, b["l1"]["t1"], amp=0.11, bright=1300)
    m.add(sub(hz("A1"), b["l1"]["t1"]), 0, wet=0.1)
    m.add(noise_bed(b["l1"]["t1"] + 1, "sea", 0.22), 0, wet=0.2)
    arp(m, ["A3", "C4", "E4", "B4"], b["l1"]["vo"], b["l1"]["t1"], step=0.55, vel=0.32)
    m.add(bell(hz("E5"), 0.12), b["l1"]["t0"] + 0.2, pan=0.7, wet=0.8)
    # l2 五毫：F 大七，船廠暖光；三聲硬幣鈴
    chord_at(m, ["F2", "C3", "E3", "A3"], b["l2"]["t0"], b["l2"]["t1"], amp=0.12, bright=1600)
    arp(m, ["F3", "A3", "C4", "E4"], b["l2"]["t0"], b["l2"]["t1"], step=0.5, vel=0.34)
    coin = b["l2"]["vo"] + 0.3 * b["l2"]["vf"]
    for i in range(3): m.add(bell(hz("B5") * (1 + 0.04 * i), 0.16, 2.2), coin + i * 0.3 + 0.35, pan=0.75, wet=0.6)
    # l3 1986：Dm 鋪底，斷裂時音樂抽空、低頻撞擊；只剩鐘錶聲
    cut = b["l3"]["vo"] + 0.34 * b["l3"]["vf"]
    chord_at(m, ["D3", "F3", "A3"], b["l3"]["t0"], cut - 0.1, amp=0.1, bright=1200)
    m.add(boom(0.8), cut, wet=0.35)
    t = cut + 0.3
    while t < b["l3"]["t1"]: m.add(tick(0.1), t, pan=0.6, wet=0.3); t += 1.0
    m.add(piano(hz("D4"), 2, 0.3), cut + 1.6, wet=0.7); m.add(piano(hz("A3"), 2, 0.22), cut + 2.4, wet=0.7)
    # l4 木樁：Am → C，每一推一聲木頭悶響，鋼琴慢慢回來
    mid = (b["l4"]["t0"] + b["l4"]["t1"]) / 2
    chord_at(m, ["A2", "E3", "A3", "C4"], b["l4"]["t0"], mid + 0.4, amp=0.1)
    chord_at(m, ["C3", "G3", "C4", "E4"], mid, b["l4"]["t1"], amp=0.12, bright=2200)
    t = b["l4"]["vo"] + 4 / FPS
    while t < b["l4"]["t1"] - 0.2: m.add(thud(0.35), t, pan=0.42, wet=0.25); t += 18 / FPS
    arp(m, ["C4", "E4", "G4", "D5"], mid, b["l4"]["t1"], step=0.6, vel=0.3)
    # l5 柴火：F → G，全片最暖；柴火劈啪
    mid = (b["l5"]["t0"] + b["l5"]["t1"]) / 2
    chord_at(m, ["F2", "A3", "C4", "E4"], b["l5"]["t0"], mid + 0.4, amp=0.13, bright=2600)
    chord_at(m, ["G2", "B3", "D4", "F#4"[:-1] + "4"], mid, b["l5"]["t1"], amp=0.13, bright=2600)
    arp(m, ["F4", "A4", "C5", "E5"], b["l5"]["t0"], mid, step=0.42, vel=0.3)
    arp(m, ["G4", "B4", "D5", "A5"], mid, b["l5"]["t1"], step=0.42, vel=0.3)
    m.add(crackle(b["l5"]["t1"] - b["l5"]["t0"] + 0.5, 0.22), b["l5"]["t0"], pan=0.65, wet=0.15)
    # l6 今天：C 加九，海聲回來；最後落在 C
    chord_at(m, ["C3", "G3", "D4", "E4"], b["l6"]["t0"], total, amp=0.13, bright=2400)
    m.add(sub(hz("C2"), total - b["l6"]["t0"]), b["l6"]["t0"], wet=0.1)
    m.add(noise_bed(total - b["l6"]["t0"] + 1, "sea", 0.18), b["l6"]["t0"], wet=0.2)
    arp(m, ["C4", "E4", "G4", "D5"], b["l6"]["t0"], b["l6"]["t1"], step=0.5, vel=0.3, oct_up=False)
    for i, n in enumerate(["G5", "E5", "C5"]): m.add(piano(hz(n), 2.5, 0.28), b["l6"]["t1"] + i * 0.55, wet=0.75)
    m.render(total, ROOT / "public/oral/score-lcv.wav")


def kaho():
    beats, total = plan(["k1", "k2", "k3", "k4", "k5", "k6"])
    b = {x["id"]: x for x in beats}
    m = Mix(total)
    # k1 撐艇：F 大七，黃昏海面
    chord_at(m, ["F2", "C3", "E3", "A3"], 0, b["k1"]["t1"], amp=0.12, bright=1600)
    m.add(noise_bed(b["k1"]["t1"] + 1, "sea", 0.2), 0, wet=0.2)
    arp(m, ["F3", "A3", "C4", "G4"], b["k1"]["vo"], b["k1"]["t1"], step=0.55, vel=0.32)
    # k2 1910 守村：D 小調，低頻緊張，遠處海浪與風
    chord_at(m, ["D2", "A2", "D3", "F3"], b["k2"]["t0"], b["k2"]["t1"], amp=0.12, bright=900)
    m.add(sub(hz("D1"), b["k2"]["t1"] - b["k2"]["t0"], 0.22), b["k2"]["t0"], wet=0.1)
    m.add(noise_bed(b["k2"]["t1"] - b["k2"]["t0"] + 1, "wind", 0.16), b["k2"]["t0"], wet=0.3)
    for i in range(3): m.add(thud(0.25), b["k2"]["vo"] + i * 1.2, pan=0.5, wet=0.6)
    # k3 夜校：降 B 大七，安靜鋼琴
    chord_at(m, ["A#2", "F3", "A3", "D4"], b["k3"]["t0"], b["k3"]["t1"], amp=0.1, bright=1500)
    arp(m, ["A#3", "D4", "F4", "A4"], b["k3"]["t0"], b["k3"]["t1"], step=0.6, vel=0.28)
    # k4 兄弟：F/A → C，溫暖
    chord_at(m, ["A2", "F3", "C4", "A3"], b["k4"]["t0"], b["k4"]["t1"], amp=0.12, bright=2200)
    arp(m, ["F4", "A4", "C5", "A4"], b["k4"]["t0"], b["k4"]["t1"], step=0.42, vel=0.3)
    # k5 搬走：G 小七，稀疏、留白
    chord_at(m, ["G2", "D3", "F3", "A#3"], b["k5"]["t0"], b["k5"]["t1"], amp=0.09, bright=1100)
    m.add(piano(hz("D4"), 2.5, 0.25), b["k5"]["t0"] + 0.2, wet=0.8); m.add(piano(hz("A#3"), 2.5, 0.2), b["k5"]["t0"] + 1.4, wet=0.8)
    # k6 賀誕：F → C → F，最滿；廟鐘、明亮琶音、輕敲擊
    third = (b["k6"]["t1"] - b["k6"]["t0"]) / 3
    for i, ch in enumerate([["F2", "C3", "A3", "F4"], ["C3", "G3", "E4", "C4"], ["F2", "C3", "A3", "F4"]]):
        chord_at(m, ch, b["k6"]["t0"] + i * third, b["k6"]["t0"] + (i + 1) * third + (2 if i == 2 else 0.3), amp=0.15, bright=3000)
    arp(m, ["F4", "A4", "C5", "F5"], b["k6"]["t0"], b["k6"]["t1"], step=0.3, vel=0.3, pattern=(0, 1, 2, 3, 2, 1))
    for i in range(3): m.add(bell(hz("C5"), 0.2, 3.5), b["k6"]["t0"] + 0.3 + i * 1.6, pan=0.3 + 0.2 * i, wet=0.7)
    t = b["k6"]["vo"]
    while t < b["k6"]["t1"]: m.add(thud(0.14), t, pan=0.5, wet=0.4); t += 0.6
    m.add(sub(hz("F1"), total - b["k6"]["t0"]), b["k6"]["t0"], wet=0.1)
    for i, n in enumerate(["C5", "A4", "F4"]): m.add(piano(hz(n), 2.5, 0.28), b["k6"]["t1"] + i * 0.55, wet=0.75)
    m.render(total, ROOT / "public/oral/score-kaho.wav")


if __name__ == "__main__":
    lcv(); kaho()
