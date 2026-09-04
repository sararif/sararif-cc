#!/usr/bin/env python3
"""
from_capcut.py — เอาซับที่ CapCut ถอดให้ฟรีอยู่แล้ว มาใช้เป็นวัตถุดิบ

ทำไมต้องมี: ไม่ใช่ทุกคนมีเงินจ่าย API ถอดเสียง และไม่ใช่ทุกเครื่องลง whisper ไหว
แต่ **CapCut ทำ auto-caption ให้ฟรีอยู่แล้ว** — ปัญหาเดียวคือมันแบ่งบรรทัดไม่เป็น
(ได้มา 3 ก้อนยาว ก้อนละ 11-20 วิ อ่านไม่ทัน)

ตัวนี้เลยไม่ถอดเสียงใหม่เลย แค่ **อ่านข้อความ + เวลาที่ CapCut มีอยู่แล้ว**
ในไฟล์โปรเจกต์ ออกมาเป็นรูปแบบเดียวกับ words.json ของ Scribe
แล้วส่งต่อให้ segment.py แบ่งบรรทัดใหม่ตามกฎไทย

= ฟรี 100% · ไม่ต้องลงอะไรเพิ่ม · ไม่ต้องมีคีย์ · ใช้ได้ทุกเครื่องที่เปิด CapCut ได้

ข้อจำกัดที่ต้องรู้: เวลาที่ได้แม่นเท่าที่ CapCut แบ่งกล่องมา — **ขอบกล่องแม่น
ส่วนข้างในกล่องเป็นการเฉลี่ยตามจำนวนตัวอักษร** ไม่ใช่เวลาจริงรายคำ
ถ้าต้องการเป๊ะระดับคำเพื่อไปตัดต่อ ให้ใช้ Scribe

ใช้:
    python3 scripts/from_capcut.py <ชื่อโปรเจกต์> --out <โฟลเดอร์>
    python3 scripts/from_capcut.py <ชื่อโปรเจกต์> --list      # ดูว่ามีแทร็กข้อความอะไรบ้าง
"""
import json, sys, argparse, pathlib

DRAFT_ROOT = pathlib.Path.home() / "Movies/CapCut/User Data/Projects/com.lveditor.draft"

# สระบน/ล่าง + วรรณยุกต์ไทย — ไม่กินเวลาพูด จึงไม่ควรถูกนับตอนเฉลี่ยเวลา
COMBINING = set("ั") | {chr(c) for c in range(0x0E34, 0x0E3B)} | {chr(c) for c in range(0x0E47, 0x0E4F)}


def seg_text(mat):
    """ข้อความจริงใน text material — CapCut เก็บเป็น JSON ซ้อนอยู่ในคีย์ content"""
    c = mat.get("content", "")
    try:
        return json.loads(c).get("text", "")
    except Exception:
        return c if isinstance(c, str) else ""


def flatten(txt):
    """รวมกล่องที่ CapCut ขึ้นบรรทัดใหม่ไว้ ให้เหลือบรรทัดเดียว

    🐛 กล่อง auto-caption ของ CapCut ที่ยาวเกินจอจะมี \\n อยู่ข้างใน (เช่น "เครื่อง\\nนะครับ")
    ถ้าปล่อยผ่าน ตารางที่ส่งต่อให้ cc.ts จะแตกเป็น 2 บรรทัด บรรทัดหลังไม่มีเวลา
    → ข้อความหลังจุดขึ้นบรรทัดหายทั้งท่อน (วัดจริง 4 ก.ย. 69: หาย 29-40% ของบรรทัด)

    ไทยไม่มีเว้นวรรค จุดที่ CapCut ตัดจึงต่อกันตรงๆ ได้ — เว้นวรรคเฉพาะตอนคาบกับอักษรโรมัน
    """
    out = []
    for part in txt.replace("\r", "\n").split("\n"):
        part = part.strip()
        if not part:
            continue
        if out and (out[-1][-1].isascii() and out[-1][-1].isalnum() or part[0].isascii() and part[0].isalnum()):
            out.append(" ")
        out.append(part)
    return "".join(out)


def read_tracks(draft):
    """คืน [(track_index, [(start_sec, end_sec, text), ...]), ...] เฉพาะแทร็กข้อความที่มีของ"""
    d = json.load(open(draft, encoding="utf-8"))
    texts = {t["id"]: t for t in d.get("materials", {}).get("texts", [])}
    out = []
    for i, tr in enumerate(d.get("tracks", [])):
        if tr.get("type") != "text":
            continue
        rows = []
        for s in tr.get("segments", []):
            mat = texts.get(s.get("material_id"))
            if not mat:
                continue
            txt = flatten(seg_text(mat))
            if not txt:
                continue
            r = s.get("target_timerange", {})
            st = r.get("start", 0) / 1e6
            rows.append((st, st + r.get("duration", 0) / 1e6, txt))
        if rows:
            out.append((i, sorted(rows)))
    return out


def to_words(rows):
    """แปลงกล่องซับ → words.json แบบเดียวกับ Scribe (เวลาต่อ 1 ตัวอักษร)

    เฉลี่ยเวลาในกล่องตามจำนวนตัวอักษรที่ออกเสียง — สระบน/ล่างและวรรณยุกต์นับเป็น 0
    เพราะไม่กินเวลาพูด (ไม่งั้นคำที่มีวรรณยุกต์เยอะจะถูกยืดเวลาเกินจริง)
    """
    words = []
    for st, en, txt in rows:
        weights = [0.0 if ch in COMBINING else 1.0 for ch in txt]
        total = sum(weights) or 1.0
        span = max(en - st, 0.0)
        t = st
        for ch, w in zip(txt, weights):
            dt = span * (w / total)
            words.append({"text": ch, "start": round(t, 3), "end": round(t + dt, 3), "type": "word"})
            t += dt
    return {"words": words}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("proj", help="ชื่อโปรเจกต์ CapCut (หรือพาธไปยัง draft_info.json)")
    ap.add_argument("--out", help="โฟลเดอร์ที่จะเขียน <proj>.words.json")
    ap.add_argument("--track", type=int, help="เลือกแทร็กข้อความ (ดูเลขจาก --list)")
    ap.add_argument("--list", action="store_true", help="ดูแทร็กข้อความที่มีแล้วจบ")
    a = ap.parse_args()

    draft = pathlib.Path(a.proj)
    if not draft.is_file():
        draft = DRAFT_ROOT / a.proj / "draft_info.json"
    if not draft.exists():
        sys.exit(f"❌ ไม่พบโปรเจกต์: {draft}\n"
                 f"   เช็คชื่อโปรเจกต์อีกที — ต้องตรงกับที่ตั้งไว้ใน CapCut")

    tracks = read_tracks(draft)
    if not tracks:
        sys.exit("❌ โปรเจกต์นี้ยังไม่มีซับเลย\n"
                 "   เปิด CapCut → เลือกคลิป → Text → Auto captions (ภาษาไทย) → รอมันถอดเสร็จ\n"
                 "   → ปิด CapCut ให้สนิท → ค่อยรันคำสั่งนี้ใหม่")

    # หลายแทร็ก = เดาให้ก่อน (แทร็กที่กล่องเยอะสุด = คำพูด ไม่ใช่ไตเติล/hook ที่มีไม่กี่กล่อง)
    # แล้วบอกวิธีเปลี่ยน — ดีกว่าหยุดให้คนไปนั่งไล่เลขเอง
    if a.track is None and len(tracks) > 1 and not a.list:
        pick = max(tracks, key=lambda t: len(t[1]))
        print(f"ℹ️ มีข้อความ {len(tracks)} แทร็ก เลือกแทร็ก {pick[0]} ({len(pick[1])} กล่อง) เป็นตัวคำพูด")
        print("   ไม่ใช่ตัวนี้ → เติม --track <เลข> จาก: "
              + " · ".join(f"{i}({len(r)})" for i, r in tracks))
        a.track = pick[0]

    if a.list:
        print(f"\n📄 เจอแทร็กข้อความ {len(tracks)} แทร็กในโปรเจกต์นี้:\n")
        for i, rows in tracks:
            avg = sum(e - s for s, e, _ in rows) / len(rows)
            print(f"  --track {i}   {len(rows):3d} กล่อง · กล่องละ ~{avg:.1f} วิ")
            for s, e, t in rows[:2]:
                print(f"              {s:6.2f}s  {t[:44]}")
            print()
        return

    idx, rows = (next((t for t in tracks if t[0] == a.track), (None, None))
                 if a.track is not None else tracks[0])
    if rows is None:
        sys.exit(f"❌ ไม่มีแทร็กเลข {a.track} — ดูเลขที่ใช้ได้ด้วย --list")

    avg = sum(e - s for s, e, _ in rows) / len(rows)
    print(f"📄 อ่านซับจาก CapCut ได้ {len(rows)} กล่อง (กล่องละ ~{avg:.1f} วิ) — ไม่ได้ถอดเสียงใหม่ ไม่เสียเงิน")

    data = to_words(rows)
    out = pathlib.Path(a.out).expanduser() if a.out else draft.parent
    out.mkdir(parents=True, exist_ok=True)
    label = draft.parent.name
    f = out / f"{label}.words.json"
    json.dump(data, open(f, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"   → {f}")

    # ขอบกล่องของ CapCut = เส้นตาย ห้ามเอาท้ายกล่องนี้ไปต่อหัวกล่องหน้า
    # (พึ่ง "ช่องว่างเวลา" อย่างเดียวไม่ได้ เพราะบางโปรเจกต์กล่องต่อกันสนิท ช่องว่าง = 0)
    b = out / f"{label}.breaks.txt"
    b.write_text("\n".join(f"{s:.3f}" for s, _, _ in rows[1:]), encoding="utf-8")

    # จำไว้ว่าอ่านมาจากแทร็กไหน — ตอนเขียนซับใหม่ต้องลบแทร็กนี้ทิ้ง ไม่งั้นซ้อนกันบนจอ
    (out / f"{label}.srctrack.txt").write_text(str(idx), encoding="utf-8")


if __name__ == "__main__":
    main()
