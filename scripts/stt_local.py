#!/usr/bin/env python3
"""
stt_local.py — ถอดเสียงคลิปด้วย whisper.cpp ในเครื่อง (ฟรี ไม่เรียก API ใคร)

ฝาแฝดของ stt_clips.py (ElevenLabs Scribe) แต่รันบนเครื่อง — ใช้เมื่อแค่อยาก
"รู้ว่าพูดอะไร" เพื่อวางลำดับ/เขียนบท ไม่ได้ต้องการ timing ระดับคำเป๊ะๆ สำหรับ cc
(cc ของงานพากย์ PVC ใช้ words.json ของไฟล์พากย์อยู่แล้ว ไม่ใช่ของคลิปดิบ)

Usage:
  python3 scripts/stt_local.py ~/Desktop/clips                    # ทั้งโฟลเดอร์
  python3 scripts/stt_local.py A.MOV B.MOV --out data/stt/malee   # ระบุไฟล์
  python3 scripts/stt_local.py <dir> --model base                 # เร็วขึ้น (ดีฟอลต์ large-v3-turbo)

output: <out>/<clip>.words.json (words[{text,start,end,type}] เหมือน Scribe) + transcript.md
"""
import os, sys, json, subprocess, argparse, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOME = pathlib.Path.home()


def find_wcli():
    """หา whisper-cli หลายที่ — รองรับทั้งลง brew และ build เอง
    สั่งทับได้ด้วย env: WHISPER_CLI=/path/to/whisper-cli"""
    if os.environ.get("WHISPER_CLI"):
        return pathlib.Path(os.environ["WHISPER_CLI"])
    for p in [ROOT / "whispercpp/build/bin/whisper-cli",
              pathlib.Path("/opt/homebrew/bin/whisper-cli"),   # brew: Apple Silicon
              pathlib.Path("/usr/local/bin/whisper-cli"),      # brew: Intel Mac
              HOME / "whisper.cpp/build/bin/whisper-cli",
              HOME / "whispercpp/build/bin/whisper-cli"]:
        if p.exists():
            return p
    return ROOT / "whispercpp/build/bin/whisper-cli"          # ไว้ให้ error บอกที่เดิม


def find_model(name):
    """หาไฟล์โมเดล .bin หลายที่ — สั่งทับได้ด้วย env: WHISPER_MODEL=/path/to/model.bin"""
    if os.environ.get("WHISPER_MODEL"):
        return pathlib.Path(os.environ["WHISPER_MODEL"])
    fn = {"turbo": "ggml-large-v3-turbo.bin", "base": "ggml-base.bin"}[name]
    for d in [ROOT / "models", HOME / ".sararif-cc/models",
              HOME / "whisper.cpp/models", ROOT / "whispercpp/models"]:
        if (d / fn).exists():
            return d / fn
    return ROOT / "models" / fn                               # ไว้ให้ error บอกที่เดิม


WCLI = find_wcli()
MODELS = {"turbo": find_model("turbo"), "base": find_model("base")}


def dur(f):
    o = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(f)],
                       capture_output=True).stdout
    try:
        return float(o)
    except Exception:
        return 0.0


def stt(wav, model, threads, dtw=None):
    """คืน dict {text, words[]} รูปแบบเดียวกับ Scribe

    ⚠️ **ไม่ใส่ `--dtw` = เวลาที่ได้เอาไปตัดต่อไม่ได้** (วัดจริง 27 ส.ค. 69 คลิป IMG_8658)
    whisper.cpp เดาเวลาจากลำดับ token ในบล็อก 30 วินาที ไม่ได้จัดตำแหน่งกับเสียงจริง
    ผลคือเวลาที่รายงาน "ช้ากว่าของจริง" มากขึ้นเรื่อยๆ ตามความยาวคลิป:
      ของจริง 16.6s → รายงาน 17.6 · 22.0 → 24.6 · 34.3 → 38.4 · 42.0 → 53.7 (คลิปยาว 45.5s)
    ใช้ได้แค่ "รู้ว่าพูดอะไร" · จะเอาไปตัด/ทำ cc ต้องส่ง --dtw ทุกครั้ง
    """
    base = str(wav.with_suffix(""))
    # -ng = ปิด Metal (GPU) บังคับรัน CPU — บนเครื่องนี้ backend Metal คืนข้อความมั่ว
    # (ทดสอบ 26 ส.ค. 69: samples/jfk.wav ออกมาว่างเปล่า/มั่วเมื่อเปิด Metal, ถูกต้องเมื่อใส่ -ng)
    cmd = [str(WCLI), "-m", str(model), "-f", str(wav), "-l", "th",
           "-t", str(threads), "-ng", "-ml", "1", "-oj", "-of", base, "-np", "-nt"]
    if dtw:
        cmd += ["-dtw", dtw]
    subprocess.run(cmd, capture_output=True)
    jf = pathlib.Path(base + ".json")
    if not jf.exists():
        return {"text": "", "words": []}
    # ⚠️ `-ml 1` ตัดทีละ token — ภาษาไทย 1 ตัวอักษรกิน 3 ไบต์ whisper.cpp จึงเขียน
    # ไบต์ครึ่งตัวลง JSON ได้ (ไฟล์ไม่ใช่ UTF-8 ที่ถูกต้อง json.loads เด้งทันที)
    # ท่าแก้: อ่านแบบ surrogateescape แล้วต่อไบต์ของ token ที่อ่านไม่ออกกับตัวถัดไปจนครบตัวอักษร
    raw = json.loads(jf.read_bytes().decode("utf-8", errors="surrogateescape"))
    jf.unlink()
    words = []
    pend, pend_start = b"", None
    for seg in raw.get("transcription", []):
        off = seg.get("offsets", {})
        if pend_start is None:
            pend_start = off.get("from", 0) / 1000.0
        pend += (seg.get("text") or "").encode("utf-8", "surrogateescape")
        try:
            t = pend.decode("utf-8").strip()
        except UnicodeDecodeError:
            continue                      # ไบต์ยังไม่ครบตัวอักษร — รอ token ถัดไป
        if t:
            words.append({"text": t, "start": pend_start,
                          "end": off.get("to", 0) / 1000.0, "type": "word"})
        pend, pend_start = b"", None
    return {"text": "".join(w["text"] for w in words), "words": words}


def stt_sliced(wav, model, threads, dtw, slice_s, workdir):
    """ถอดทีละท่อนสั้นแล้วต่อเวลาเอง — ท่าเดียวที่ได้เวลาที่ "เอาไปตัดได้" บนเครื่องนี้

    ทำไม: ความคลาดของเวลาโตตามความยาวคลิป (คลิป 14.7 วิ ตรง · คลิป 45.5 วิ เพี้ยนถึง +11.7 วิ
    ที่ปลายคลิป · `-dtw` ของ whisper.cpp กับโมเดล turbo ไม่ช่วย ให้ผลเท่าเดิมเป๊ะ)
    ซอยเป็นท่อนละ slice_s วินาที = ความคลาดถูกจำกัดอยู่ในท่อน แล้วบวก offset ของท่อนคืน

    ราคาที่จ่าย: คำที่คร่อมรอยต่อท่อนจะถูกตัดครึ่ง (ท่อนละ 1 คำ) — ยอมได้สำหรับงานเลือกจุดตัด
    """
    total = float(subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(wav)], capture_output=True).stdout or 0)
    piece = workdir / "_slice.wav"
    words, off = [], 0.0
    while off < total - 0.05:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{off:.3f}",
                        "-t", f"{slice_s:.3f}", "-i", str(wav), str(piece)],
                       capture_output=True)
        r = stt(piece, model, threads, dtw)
        for w in r["words"]:
            words.append({**w, "start": w["start"] + off, "end": w["end"] + off})
        off += slice_s
    if piece.exists():
        piece.unlink()
    return {"text": "".join(w["text"] for w in words), "words": words}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", help="โฟลเดอร์ หรือไฟล์คลิป")
    ap.add_argument("--out", default=None)
    ap.add_argument("--model", default="turbo", choices=list(MODELS))
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--slice", type=float, default=0,
                    help="ซอยเสียงเป็นท่อนละกี่วินาทีก่อนถอด (0 = ไม่ซอย). "
                         "ใส่ 12 เมื่อจะเอาเวลาไปตัดต่อ/ทำ cc — ดูเหตุผลใน stt_sliced()")
    ap.add_argument("--dtw", default="large.v3",
                    help="preset ของ whisper.cpp สำหรับ token-level timestamp "
                         "(large.v3-turbo คู่กับโมเดล turbo) — ใส่ \"\" เพื่อปิด")
    a = ap.parse_args()

    model = MODELS[a.model]
    if not WCLI.exists() or not model.exists():
        msg = ["❌ ยังใช้ทางฟรี (whisper ในเครื่อง) ไม่ได้ — ขาดของ:"]
        if not WCLI.exists():
            msg += [f"   • ไม่เจอ whisper-cli (หาแล้วที่ {WCLI})",
                    "     ติดตั้ง:  brew install whisper-cpp"]
        if not model.exists():
            fn = {"turbo": "ggml-large-v3-turbo.bin", "base": "ggml-base.bin"}[a.model]
            msg += [f"   • ไม่เจอไฟล์โมเดล {fn}",
                    f"     โหลด:  mkdir -p ~/.sararif-cc/models && curl -L -o ~/.sararif-cc/models/{fn} \\",
                    f"              https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{fn}",
                    "     (turbo ~1.5GB · base ~150MB เร็วกว่าแต่แม่นน้อยกว่า)"]
        msg += ["", "   หรือชี้เองด้วย env:  WHISPER_CLI=... WHISPER_MODEL=... python3 scripts/stt_local.py ...",
                "   ทางที่ง่ายกว่า: ใช้ ElevenLabs Scribe (~฿1 ต่อคลิป 3 นาที) — ดู README"]
        sys.exit("\n".join(msg))

    clips, label = [], "clips"
    if len(a.inputs) == 1 and pathlib.Path(a.inputs[0]).expanduser().is_dir():
        d = pathlib.Path(a.inputs[0]).expanduser()
        label = d.name
        clips = sorted(p for p in d.iterdir()
                       if p.suffix.lower() in (".mov", ".mp4", ".m4v",
                                               ".mp3", ".wav", ".m4a", ".aac"))
    else:
        clips = [pathlib.Path(x).expanduser() for x in a.inputs]

    out = pathlib.Path(a.out).expanduser() if a.out else ROOT / "data" / "stt" / label
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "_probe.wav"

    lines = [f"# ถอดเสียง (local whisper): {label}  ({len(clips)} คลิป)\n"]
    for p in clips:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(p),
                        "-ac", "1", "-ar", "16000", str(tmp)], capture_output=True)
        res = (stt_sliced(tmp, model, a.threads, a.dtw or None, a.slice, out)
               if a.slice else stt(tmp, model, a.threads, a.dtw or None))
        (out / f"{p.stem}.words.json").write_text(
            json.dumps(res, ensure_ascii=False, indent=2))
        text = res["text"].strip()
        print(f"🎙️  {p.stem}  ({dur(p):.1f}s)  {text or '— เงียบ/ไม่มีคำ —'}", flush=True)
        lines.append(f"## {p.stem}  ({dur(p):.1f}s)\n{text or '_— เงียบ —_'}\n")
    if tmp.exists():
        tmp.unlink()

    (out / "transcript.md").write_text("\n".join(lines))
    print(f"\n✅ เก็บที่ {out}/")


if __name__ == "__main__":
    main()
