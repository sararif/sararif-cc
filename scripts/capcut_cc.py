#!/usr/bin/env python3
"""
capcut_cc.py — inject ซับ cc (phrase สั้น ตัดครบคำไทย) เข้า CapCut จากเสียงพาก STT
   แก้ปัญหา CapCut auto-caption ที่ทำประโยคยาว ต้องมาตัดคำเอง
   ใช้ grouping ของ make_subs.py (pythainlp newmm — ตัดครบคำ + STARTERS/ENDERS)

ใช้:
  python3 scripts/capcut_cc.py <proj> \
     --sub data/stt/xxx/narration_A.words.json:0.0 \
     --sub data/stt/xxx/narration_B_cta.words.json:38.6 \
     [--maxchars 16] [--y -0.80] [--size 15]
  (--sub = <words.json>:<offset วินาที บนไทม์ไลน์>  ใส่ได้หลายท่อน)

⚠️ ปิด CapCut ก่อนรัน. สำรอง .PRE_CC_BAK
"""
import json, sys, argparse, uuid, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from make_subs import load_chars, apply_fix, words_with_time, group  # reuse grouping ไทย

US = 1_000_000
uid = lambda: str(uuid.uuid4()).upper()

# ── หาไฟล์ฟอนต์ ────────────────────────────────────────────────────────
# ⚠️ path ฟอนต์เป็น "cache ของ CapCut เครื่องนั้นๆ" ไม่ใช่ path มาตรฐาน
#    เครื่องคนอื่นจะมีเลข resource/hash คนละชุด → hardcode ไว้ = เครื่องอื่นใช้ไม่ได้
#    (แก้ 31 ส.ค. 69 ตอนเตรียมแจกเครื่องมือให้คนอื่น)
#
# ลำดับที่ลอง: ตัวที่ระบุมาเอง → มหานครบนเครื่องนี้ → ฟอนต์ไหนก็ได้ที่ CapCut โหลดไว้แล้ว → ไม่ใส่ฟอนต์
MAHA_RES = "7545362452553174273"   # resource id ของ "มหานคร"
CACHE_DIRS = [
    pathlib.Path.home() / "Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect",
    pathlib.Path.home() / "Movies/CapCut/User Data/Cache/effect",
]


def resolve_font(explicit=None):
    """คืน (font_path, resource_id) — คืน (None, None) ถ้าไม่เจอ = ใช้ฟอนต์ default ของ CapCut

    resource_id ต้องมาคู่กับ path เสมอ (ชื่อโฟลเดอร์ชั้นบนสุดคือ id ของฟอนต์นั้น)
    ถ้าจับคู่ผิด CapCut จะงงและอาจไม่เรนเดอร์ตัวอักษร
    """
    if explicit:
        p = pathlib.Path(explicit).expanduser()
        if not p.exists():
            raise SystemExit(f"❌ ไม่พบไฟล์ฟอนต์ที่ระบุ: {p}")
        # ถ้าอยู่ในโครง cache ของ CapCut ให้ดึง resource id จากชื่อโฟลเดอร์
        rid = p.parent.parent.name if p.parent.parent.name.isdigit() else ""
        return str(p), rid

    # 1) มหานคร (ฟอนต์ที่ใช้ประจำ) ถ้าเครื่องนี้โหลดไว้แล้ว
    for cache in CACHE_DIRS:
        for f in sorted(cache.glob(f"{MAHA_RES}/*/font.ttf")):
            return str(f), MAHA_RES

    # 2) ฟอนต์อะไรก็ได้ที่ CapCut โหลดเก็บไว้ — ดีกว่าไม่มีฟอนต์
    for cache in CACHE_DIRS:
        for f in sorted(cache.glob("*/*/font.ttf")):
            rid = f.parent.parent.name
            if rid.isdigit():
                return str(f), rid

    # 3) ไม่เจอเลย → ปล่อยว่าง CapCut จะใช้ฟอนต์ default ของมันเอง (ซับยังขึ้นปกติ)
    return None, None


def _hex_to_rgb01(h):
    h = h.lstrip("#")
    return [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]


def text_material(txt, size, stroke_w=0.06, stroke_color="#000000", font=(None, None)):
    font_path, font_res = font
    style = {
        "range": [0, len(txt)], "size": size, "bold": True,
        "fill": {"alpha": 1.0, "content": {"render_type": "solid", "solid": {"color": [1, 1, 1]}}},
    }
    # ใส่ฟอนต์เฉพาะเมื่อหาไฟล์เจอจริง — ชี้ไปไฟล์ที่ไม่มีอยู่ = เสี่ยงไม่เรนเดอร์ตัวอักษร
    if font_path:
        style["font"] = {"path": font_path, "id": font_res}
    if stroke_w > 0:
        # stroke จริงที่ CapCut เรนเดอร์ = styles[].strokes (เส้นขอบรอบตัวอักษร) — ขาวล้วนอ่านไม่ออกถ้าไม่มี
        style["strokes"] = [{
            "content": {"render_type": "solid", "solid": {"alpha": 1.0, "color": _hex_to_rgb01(stroke_color)}},
            "width": stroke_w,
        }]
    content = json.dumps({"text": txt, "styles": [style]}, ensure_ascii=False)
    return {
        "id": uid(), "type": "text", "content": content, "alignment": 1,
        "letter_spacing": 0, "line_spacing": 0.02, "line_max_width": 0.82, "line_feed": 1,
        "text_color": "#FFFFFF", "text_alpha": 1.0, "text_size": 30, "font_size": size,
        "font_path": font_path or "", "font_name": "", "font_id": "",
        "font_resource_id": font_res or "",
        "font_title": "มหานคร" if font_res == MAHA_RES else "", "bold_width": 0.02,
        # top-level border = fallback ให้ CapCut รุ่นที่อ่าน field นี้ (border_mode 1 = ขอบรอบตัว)
        "border_color": stroke_color if stroke_w > 0 else "",
        "border_width": stroke_w, "border_alpha": 1.0 if stroke_w > 0 else 0.0,
        "border_mode": 1 if stroke_w > 0 else 0,
        "has_shadow": True, "shadow_alpha": 0.9, "shadow_angle": -45.0, "shadow_color": "#000000",
        "shadow_distance": 5.0, "shadow_smoothing": 0.45, "background_color": "", "background_alpha": 1.0,
        "underline": False, "italic_degree": 0, "global_alpha": 1.0, "check_flag": 7,
        "force_apply_line_max_width": False, "typesetting": 0, "sub_type": 0, "add_type": 0,
        "fonts": [{"id": uid(), "resource_id": font_res, "third_resource_id": "", "category_id": "favoured",
                   "category_name": "Favorites", "source_platform": 1, "path": font_path,
                   "effect_id": font_res, "title": "มหานคร" if font_res == MAHA_RES else "",
                   "team_id": "", "file_uri": "", "request_id": ""}] if font_path else [],
        "words": {"end_time": [], "start_time": [], "text": []}, "relevance_segment": [], "name": "",
    }


def align_phrases(phrase_file, words):
    """จับคู่วลีที่เขียนเอง (1 บรรทัด = 1 ซับ) กับ word timing จาก STT

    ตัดตามหน่วยความหมาย ไม่ใช่จำนวนตัวอักษร — ดู feedback_cc_sentence_boundaries
    คืน [(start, end, text)]. เทียบแบบตัดช่องว่างทิ้ง เพราะ STT เว้นวรรคไม่ตรงกับบท
    """
    strip = lambda s: "".join(s.split())
    phrases = [l.strip() for l in pathlib.Path(phrase_file).read_text().splitlines() if l.strip()]
    wi, out = 0, []
    for ph in phrases:
        target, buf, st, en = strip(ph), "", None, None
        while wi < len(words) and len(buf) < len(target):
            w_txt, w_st, w_en = words[wi]
            if st is None:
                st = w_st
            buf += strip(w_txt); en = w_en; wi += 1
        if st is None:
            raise SystemExit(f"❌ วลีเกินคำที่มี: {ph!r} — เช็คว่าไฟล์วลีตรงกับบทพากไหม")
        if buf != target:
            raise SystemExit(f"❌ วลีไม่ตรงเสียงพาก:\n   บท : {target}\n   เสียง: {buf}")
        out.append((st, en, ph))
    if wi < len(words):
        left = "".join(strip(w[2]) for w in words[wi:])
        raise SystemExit(f"❌ ยังมีเสียงเหลือไม่มีซับ: {left!r}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("proj")
    ap.add_argument("--sub", action="append", required=True, help="<words.json>:<offset>")
    ap.add_argument("--phrases", action="append", default=[],
                    help="<ไฟล์วลี 1 บรรทัด=1 ซับ>:<offset> — คู่กับ --sub ลำดับเดียวกัน. "
                         "ตัดตามหน่วยความหมายที่เขียนเอง แทน group() ที่นับตัวอักษร "
                         "(ห้ามแตกชื่อจาน/คำประสม เช่น ทับทิมกรอบ, ปักหมุด)")
    ap.add_argument("--maxchars", type=int, default=16)
    ap.add_argument("--gap", type=float, default=0.4)
    ap.add_argument("--y", type=float, default=-0.80)
    ap.add_argument("--size", type=int, default=15)
    ap.add_argument("--stroke", type=float, default=0.06,
                    help="ความหนา stroke ขอบตัวอักษร 0-0.2 (default 0.06 = อ่านง่ายบนพื้นสว่าง). 0 = ปิด")
    ap.add_argument("--stroke-color", default="#000000")
    ap.add_argument("--font", default=None, help="ไฟล์ฟอนต์ .ttf (ไม่ใส่ = หาให้เอง)")
    a = ap.parse_args()

    FONT = resolve_font(a.font)
    print(f"🔤 ฟอนต์: {FONT[0] or 'default ของ CapCut (ไม่พบไฟล์ฟอนต์ในเครื่อง)'}")

    DRAFT = pathlib.Path.home() / f"Movies/CapCut/User Data/Projects/com.lveditor.draft/{a.proj}/draft_info.json"
    draft = json.loads(DRAFT.read_text())
    (DRAFT.parent / "draft_info.json.PRE_CC_BAK").write_text(json.dumps(draft))

    # segment template = video segment แรก (field ครบ) แปลงเป็น text segment
    vtpl = draft["tracks"][0]["segments"][0]

    def text_segment(mid, start_us, dur_us, ridx):
        s = json.loads(json.dumps(vtpl))
        s["id"] = uid(); s["material_id"] = mid
        s["target_timerange"] = {"start": start_us, "duration": dur_us}
        s["source_timerange"] = None
        s["render_index"] = ridx
        s["extra_material_refs"] = []
        s["clip"] = {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False},
                     "rotation": 0.0, "scale": {"x": 1.0, "y": 1.0}, "transform": {"x": 0.0, "y": a.y}}
        s["volume"] = 1.0; s["visible"] = True
        s["keyframe_refs"] = []; s["common_keyframes"] = []; s["caption_info"] = None
        return s

    segs, ridx, total = [], 16100, 0
    for i, spec in enumerate(a.sub):
        path, _, off = spec.rpartition(":")
        offset = float(off)
        text, times = load_chars(path)
        text, times = apply_fix(text, times)
        words = words_with_time(text, times)
        pspec = a.phrases[i] if i < len(a.phrases) else None
        lines = align_phrases(pspec.rpartition(":")[0], words) if pspec \
            else group(words, a.maxchars, a.gap)
        for st, en, txt in lines:
            m = text_material(txt, a.size, a.stroke, a.stroke_color, FONT)
            draft["materials"]["texts"].append(m)
            segs.append(text_segment(m["id"], round((st + offset) * US), round((en - st) * US), ridx))
            ridx += 1; total += 1
            print(f"  {st+offset:5.1f}s  {txt}")

    draft["tracks"].append({"id": uid(), "type": "text", "segments": segs,
                            "flag": 0, "attribute": 0, "name": "", "is_default_name": True})
    DRAFT.write_text(json.dumps(draft, ensure_ascii=False))
    print(f"✅ inject cc {total} วลี (มหานคร, ตัดครบคำ, y={a.y}) — สำรอง .PRE_CC_BAK")


if __name__ == "__main__":
    main()
