#!/usr/bin/env python3
"""
capcut_hook.py — ใส่ข้อความ hook ตัวใหญ่ไว้บนคลิป (ท่อนเปิด)

ใช้ตัวสร้างข้อความชุดเดียวกับ capcut_cc.py — ฟอนต์ธรรมดาที่ CapCut มีอยู่แล้ว
ไม่ใช้ text template ของ CapCut (template ทำให้ตำแหน่งที่จัดเองโดนทับ)

ใช้:
  python3 scripts/capcut_hook.py <proj> --l1 "บรรทัดบน" --l2 "บรรทัดล่าง" \
     [--start 0] [--dur 3] [--y 0.55] [--size 22] [--color "#FFD400"]

⚠️ ปิด CapCut ก่อนรัน. สำรอง .PRE_HOOK_BAK
"""
import json, sys, argparse, uuid, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from capcut_cc import resolve_font, text_material, US   # ใช้ตัวสร้างข้อความตัวเดียวกับซับ

uid = lambda: str(uuid.uuid4()).upper()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("proj")
    ap.add_argument("--l1", required=True, help="บรรทัดที่ 1")
    ap.add_argument("--l2", default=None)
    ap.add_argument("--l3", default=None)
    ap.add_argument("--start", type=float, default=0.0, help="วินาทีที่เริ่มโชว์")
    ap.add_argument("--dur", type=float, default=3.0, help="โชว์นานกี่วินาที")
    ap.add_argument("--y", type=float, default=0.55, help="ตำแหน่งแนวตั้ง (1 = บนสุด, -1 = ล่างสุด)")
    ap.add_argument("--size", type=int, default=22)
    ap.add_argument("--color", default="#FFD400", help="สีคำที่เน้น (คำในวงเล็บเหลี่ยม)")
    ap.add_argument("--font", default=None)
    ap.add_argument("--stroke", type=float, default=0.08)
    a = ap.parse_args()

    lines = [l for l in (a.l1, a.l2, a.l3) if l]
    # คำที่อยากให้เป็นสีเหลือง ให้ใส่ [วงเล็บเหลี่ยม] มา — เอาวงเล็บออกแล้วเน้นสีคำข้างใน
    txt, keywords = "\n".join(lines), []
    while "[" in txt and "]" in txt:
        i, j = txt.index("["), txt.index("]")
        if j < i:
            break
        keywords.append(txt[i + 1:j])
        txt = txt[:i] + txt[i + 1:j] + txt[j + 1:]

    FONT = resolve_font(a.font)
    print(f"🔤 ฟอนต์: {FONT[0] or 'default ของ CapCut'}")
    if keywords:
        print(f"🟡 เน้นสี {a.color}: {' · '.join(keywords)}")

    DRAFT = pathlib.Path.home() / f"Movies/CapCut/User Data/Projects/com.lveditor.draft/{a.proj}/draft_info.json"
    if not DRAFT.exists():
        raise SystemExit(f"❌ ไม่พบโปรเจกต์ \"{a.proj}\"")
    draft = json.loads(DRAFT.read_text())
    (DRAFT.parent / "draft_info.json.PRE_HOOK_BAK").write_text(json.dumps(draft))

    vtpl = draft["tracks"][0]["segments"][0]
    m = text_material(txt, a.size, a.stroke, "#000000", FONT, keywords, a.color)
    draft["materials"]["texts"].append(m)

    s = json.loads(json.dumps(vtpl))
    s["id"] = uid(); s["material_id"] = m["id"]
    s["target_timerange"] = {"start": round(a.start * US), "duration": round(a.dur * US)}
    s["source_timerange"] = None
    s["render_index"] = 17000
    s["extra_material_refs"] = []
    s["clip"] = {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False},
                 "rotation": 0.0, "scale": {"x": 1.0, "y": 1.0}, "transform": {"x": 0.0, "y": a.y}}
    s["volume"] = 1.0; s["visible"] = True
    s["keyframe_refs"] = []; s["common_keyframes"] = []; s["caption_info"] = None

    draft["tracks"].append({"id": uid(), "type": "text", "segments": [s],
                            "flag": 0, "attribute": 0, "name": "", "is_default_name": True})
    DRAFT.write_text(json.dumps(draft, ensure_ascii=False))
    for l in lines:
        print(f"   {l}")
    print(f"✅ ใส่ hook {a.start:.1f}–{a.start + a.dur:.1f} วิ (y={a.y}, ขนาด {a.size}) — สำรอง .PRE_HOOK_BAK")


if __name__ == "__main__":
    main()
