#!/usr/bin/env python3
"""
stt_clips.py — ถอดเสียงคลิปหลายไฟล์ (ElevenLabs Scribe, ไทย) → words JSON ต่อคลิป + ถอดความรวม

ใช้เตรียมงานตัด: รู้ว่าพี่พูดอะไร (ชื่อร้าน/เมนู/เรื่องเล่า), เจตนาพูด, timing สำหรับซับ/ตัดเงียบ

Usage:
  python3 scripts/stt_clips.py ~/Downloads/IMG_4756-4777           # ทั้งโฟลเดอร์ (เรียงชื่อ)
  python3 scripts/stt_clips.py A.MOV B.MOV                          # ระบุไฟล์
  python3 scripts/stt_clips.py <dir> --out data/stt/kaotomkuy       # กำหนดที่เก็บ

output: <out>/<clip>.words.json (มี words[{text,start,end,type}]) + <out>/transcript.md (อ่านคน)
default out: data/stt/<ชื่อโฟลเดอร์หรือ 'clips'>/
"""
import os, sys, json, subprocess, argparse, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def key():
    env = ROOT / ".env"
    if env.exists():
        for l in env.read_text().splitlines():
            if l.startswith("ELEVENLABS_API_KEY="):
                return l.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("ELEVENLABS_API_KEY", "")


KEY = key()


def dur(f):
    o = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(f)],
                       capture_output=True).stdout
    try:
        return float(o)
    except Exception:
        return 0.0


def stt(wav):
    cmd = ["curl", "-s", "-X", "POST", "https://api.elevenlabs.io/v1/speech-to-text",
           "-H", f"xi-api-key: {KEY}", "-F", "model_id=scribe_v1",
           "-F", "language_code=tha", "-F", "timestamps_granularity=word",
           # diarize = แยกผู้พูด (Scribe คืน speaker_id ต่อคำ)
           # ⚠️ จำเป็นสำหรับคลิปอบรม/สัมมนา: Sharif สั่ง 10 ส.ค. 69 ว่า cc ต้องใช้ "เสียงพี่" เท่านั้น
           #    ยกเว้นคลิปที่มีแต่เสียงวิทยากรล้วน → ทำ cc เสียงวิทยากรได้
           "-F", "diarize=true",
           "-F", f"file=@{wav}"]
    out = subprocess.run(cmd, capture_output=True).stdout.decode()
    try:
        return json.loads(out)
    except Exception:
        return {"text": "", "words": [], "_raw": out[:300]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", help="โฟลเดอร์ หรือไฟล์คลิป")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    if not KEY:
        sys.exit("❌ ไม่มี ELEVENLABS_API_KEY ใน .env")

    # รวบรวมไฟล์
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

    lines = [f"# ถอดเสียง: {label}  ({len(clips)} คลิป)\n"]
    for p in clips:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(p),
                        "-ac", "1", "-ar", "16000", str(tmp)], capture_output=True)
        res = stt(tmp)
        (out / f"{p.stem}.words.json").write_text(
            json.dumps(res, ensure_ascii=False, indent=2))
        text = (res.get("text") or "").strip()
        nwords = len([w for w in res.get("words", []) if w.get("type") == "word"])
        print(f"🎙️  {p.stem}  ({dur(p):.1f}s, {nwords} คำ)")
        print(f"    {text or '— เงียบ/ไม่มีคำ —'}")
        lines.append(f"## {p.stem}  ({dur(p):.1f}s)\n{text or '_— เงียบ —_'}\n")
    if tmp.exists():
        tmp.unlink()

    (out / "transcript.md").write_text("\n".join(lines))
    print(f"\n✅ เก็บที่ {out}/ (words.json ต่อคลิป + transcript.md)")


if __name__ == "__main__":
    main()
