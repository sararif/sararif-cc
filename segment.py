#!/usr/bin/env python3
"""
segment.py — แบ่งวลีซับไทย ต่อยอดจาก group() ของ make_subs.py

ทำไมต้องมี: group() เดิมทำตามกฎซับได้ 3 ข้อ (ไม่ตัดกลางคำ · ไม่ทิ้งคำลงท้ายโดด ·
ตัดก่อนคำเชื่อม) แต่ยังไม่ได้กันข้อที่ CC_CUTTING_RULES ข้อ 3 เขียนไว้อีกครึ่งหนึ่ง คือ
**ห้ามปล่อยคำเชื่อม/บุพบทค้างท้ายบรรทัด**

เห็นจริงตอนทดสอบ 31 ส.ค. 69:
    ...มีความสามารถใน   ← "ใน" ค้างท้าย
    การหาเงิน...
    ...ที่เรามีมันไม่    ← "ไม่" ค้างท้าย
    ได้ดีเท่าเดิมครับ

ตัวนี้แก้โดย: เวลาจะตัดบรรทัด ถ้าคำสุดท้ายของบรรทัดเป็นคำที่ห้ามค้างท้าย
ให้ยังไม่ตัด รับคำถัดไปเข้ามาก่อน แล้วค่อยตัด

ใช้:
    python3 segment.py <words.json> [--maxchars 16] [--gap 0.4] [--offset 0]
    → พิมพ์  start<TAB>end<TAB>ข้อความ  ทีละบรรทัด
"""
import sys, json, argparse, pathlib

# ใช้ตัวตัดคำ + FIX dict ของระบบเดิม (pythainlp newmm)
# หา make_subs.py ได้ทั้ง 2 โครง: ชุดที่แพ็กแจก (อยู่ข้างๆ กัน) และในโปรเจกต์ต้นทาง
HERE = pathlib.Path(__file__).resolve().parent
for cand in (HERE, HERE.parent.parent):
    if (cand / "make_subs.py").exists():
        sys.path.insert(0, str(cand))
        break
else:
    sys.exit("❌ ไม่พบ make_subs.py — ต้องอยู่โฟลเดอร์เดียวกับ segment.py")
from make_subs import load_chars, apply_fix, words_with_time, ENDERS, STARTERS, MINLEN  # noqa: E402

# ── คำที่ห้ามอยู่ท้ายบรรทัด (ต้องเกาะกับก้อนความหมายที่ตามมา) ──────────
# บุพบท + คำเชื่อม + คำปฏิเสธ — ถ้าค้างท้าย คนอ่านจะสะดุดเพราะประโยคยังไม่จบ
TRAILING_BAN = {
    # บุพบท
    "ใน", "จาก", "กับ", "บน", "ให้", "ลง", "ของ", "ที่", "แก่", "ต่อ", "โดย", "ตาม", "ถึง",
    # คำเชื่อม
    "และ", "หรือ", "แต่", "ว่า", "ซึ่ง", "เพราะ", "ก็", "แล้ว", "จน", "เพื่อ",
    # คำปฏิเสธ/ช่วยกริยา ที่ต้องมีคำตามหลัง
    "ไม่", "ยัง", "ต้อง", "จะ", "กำลัง", "เคย", "ได้",
}


def group_v2(words, maxchars, gap):
    """เหมือน group() เดิม แต่เพิ่มกฎ: ห้ามจบบรรทัดด้วยคำใน TRAILING_BAN

    คืน [(start, end, text)]
    """
    import re
    from make_subs import LOANWORDS

    lines, cur, start, last = [], [], None, None

    def curlen():
        return sum(len(x) for x in cur)

    def is_foreign(t):
        return t in LOANWORDS or bool(re.search(r"[A-Za-z]", t))

    def smart_join(toks):
        out = ""
        for i, t in enumerate(toks):
            if i > 0 and (is_foreign(t) or is_foreign(toks[i - 1])):
                out += " "
            out += t
        return out.strip()

    def flush():
        nonlocal cur, start, last
        if cur:
            lines.append((start, last, smart_join(cur)))
        cur, start, last = [], None, None

    def ends_badly():
        """บรรทัดตอนนี้จบด้วยคำที่ห้ามค้างท้ายไหม"""
        return bool(cur) and cur[-1] in TRAILING_BAN

    for tk, st, en in words:
        # ตัดก่อนคำเชื่อมขึ้นประโยคใหม่ — แต่ไม่ตัดถ้าบรรทัดจะจบด้วยคำต้องห้าม
        if cur and curlen() >= MINLEN and tk in STARTERS and not ends_badly():
            flush()

        # ตัดเมื่อยาวเกิน/เว้นช่วงนาน — ยกเว้น 2 กรณี
        #   1) คำถัดไปเป็นคำปิดประโยค (ครับ/ค่ะ/อ่ะ) → ให้เกาะปิดบรรทัดเดิม
        #   2) บรรทัดจะจบด้วยคำต้องห้าม → รับคำนี้เข้ามาก่อนแล้วค่อยตัดรอบหน้า
        if cur and tk not in ENDERS and not ends_badly() and (
            curlen() + len(tk) > maxchars or (st - last) > gap
        ):
            flush()

        if not cur:
            start = st
        cur.append(tk)
        last = en

        if tk in ENDERS and cur:
            flush()

    flush()
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("words_json")
    ap.add_argument("--maxchars", type=int, default=16)
    ap.add_argument("--gap", type=float, default=0.4)
    ap.add_argument("--offset", type=float, default=0.0)
    ap.add_argument("--legacy", action="store_true", help="ใช้ group() เดิม ไม่ใช้กฎห้ามค้างท้าย")
    a = ap.parse_args()

    text, times = load_chars(a.words_json)
    text, times = apply_fix(text, times)
    words = words_with_time(text, times)

    if a.legacy:
        from make_subs import group
        lines = group(words, a.maxchars, a.gap)
    else:
        lines = group_v2(words, a.maxchars, a.gap)

    for st, en, tx in lines:
        print(f"{st + a.offset:.3f}\t{en + a.offset:.3f}\t{tx}")


if __name__ == "__main__":
    main()
