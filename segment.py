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
# รายการนี้ไม่ได้คิดเอง — มาจากการเทียบซับที่คนตัดเองกับซับที่โปรแกรมตัด แล้วเก็บคำที่โดนแก้
TRAILING_BAN = {
    # บุพบท
    "ใน", "จาก", "กับ", "บน", "ให้", "ลง", "ของ", "ที่", "แก่", "ต่อ", "โดย", "ตาม", "ถึง",
    "ทาง", "ในการ", "ของการ",
    # คำเชื่อม
    "และ", "หรือ", "แต่", "ว่า", "ซึ่ง", "เพราะ", "เพราะว่า", "ก็", "แล้ว", "จน", "เพื่อ",
    "เพื่อที่จะ", "ที่จะ", "ถ้า", "พอ", "เมื่อ", "คือ",
    # คำปฏิเสธ/ช่วยกริยา ที่ต้องมีคำตามหลัง
    "ไม่", "ยัง", "ต้อง", "จะ", "กำลัง", "เคย", "ได้", "เป็น", "มี", "อยู่",
    # กริยาที่ต้องมีกรรมตามหลัง
    "ทำ", "เอา", "ใช้", "ไป", "มา", "ดู", "ลอง", "กด", "พิมพ์",
    # คำนามกว้างๆ ที่ต้องมีส่วนขยาย
    "การ", "ความ", "เรื่อง", "ตัว", "ตอน", "อย่าง", "แบบ", "ที",
    # สรรพนาม — ขึ้นประโยคใหม่ ไม่ควรห้อยท้ายบรรทัดเก่า (กฎข้อ 6)
    "ผม", "เรา", "คุณ", "เขา", "มัน", "พวก",
    # filler เปิดประโยค — ต้องไปขึ้นต้นบรรทัดถัดไป ไม่ใช่ค้างท้าย (กฎข้อ 9)
    "เออ", "เอ่อ", "เอ๊ะ", "อืม", "อ้าว", "โอ้", "โคตร", "นะ", "อ่ะ",
}

# ── คำที่ห้ามขึ้นต้นบรรทัด (ต้องเกาะท้ายบรรทัดก่อนหน้า) ─────────────────
# คำลงท้าย + คำขยายที่ไม่มีความหมายถ้ายืนเดี่ยว
# ตัวอย่างที่โดนแก้จริง: "ปริญญาเอกเลย / นะประเด็นเลย" → "ปริญญาเอกเลยนะ / ประเด็นเลยคือว่า"
LEADING_BAN = {
    "ครับ", "ค่ะ", "นะ", "นะครับ", "จ้า", "เนาะ", "หรอก", "อ่ะ", "ล่ะ", "สิ", "เถอะ",
    "นี้", "นั้น", "นี่", "นั่น", "ๆ", "กัน", "เลย", "แล้ว", "อยู่", "ไว้", "ด้วย",
    "ได้", "มาก", "ที่สุด", "จริงๆ",
}


def group_v2(words, maxchars, gap, breaks=(), scenes=()):
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

    def flush(end_at=None):
        """ปิดบรรทัดปัจจุบัน — end_at ใช้ตอนตัดที่รอยตัดภาพ ให้ซับจบตรงรอยตัดพอดี

        เวลาของคำมาจากการเฉลี่ยตามตัวอักษร คำหนึ่งจึงคร่อมรอยตัดได้
        ถ้าไม่หด ซับจะค้างต่อไปอีก ~0.3 วิ บนฉากใหม่
        """
        nonlocal cur, start, last
        if cur:
            en = last if end_at is None else max(start + 0.05, min(last, end_at))
            lines.append((start, en, smart_join(cur)))
        cur, start, last = [], None, None

    def ends_badly():
        """บรรทัดตอนนี้จบด้วยคำที่ห้ามค้างท้ายไหม"""
        return bool(cur) and cur[-1] in TRAILING_BAN

    def cant_lead(t):
        """คำนี้ขึ้นต้นบรรทัดใหม่ไม่ได้ — ต้องเกาะท้ายบรรทัดก่อนหน้า

        คำลงท้าย (นะ/ครับ/เนาะ) และคำขยายที่ยืนเดี่ยวไม่มีความหมาย
        รวมถึงคำอังกฤษ ที่ต้องอยู่กับคำไทยที่ขยายมัน ("คนใน / Hall" อ่านสะดุด)
        """
        return t in LEADING_BAN or bool(re.match(r"^[A-Za-z]", t))

    brk = list(breaks)
    scn = list(scenes)
    for tk, st, en in words:
        # ── รอยตัดภาพ: ตัดเสมอ ไม่มีข้อยกเว้น ──
        # ซับที่ลากข้ามรอยตัดจะค้างคร่อมฉากถัดไป ผิดกฎ "ทุกรอยตัด = จบความคิด"
        # ชนะกฎห้ามขึ้นบรรทัดด้วยคำลงท้าย เพราะคำที่พูดหลังรอยตัด = ของฉากใหม่จริงๆ
        while scn and st >= scn[0] - 1e-6:
            if cur:
                flush(end_at=scn[0])
            scn.pop(0)

        # ── เส้นตาย: ขอบกล่องซับต้นทาง (เช่นกล่องของ CapCut auto-caption) ──
        # ตัดแน่นอน ไม่สนกฎอื่นเลย เพราะข้ามขอบกล่อง = เอาคนละประโยคมาต่อกัน
        # ใช้แทนการเดาจาก "ช่องว่างเวลา" ซึ่งพังเมื่อกล่องต่อกันสนิท (ช่องว่าง = 0)
        while brk and st >= brk[0] - 1e-6:
            # ตัดที่ขอบกล่อง ยกเว้นกรณีเดียว: บรรทัดที่ค้างอยู่สั้นเกินไป **และ** เสียงต่อเนื่อง
            # (CapCut ตัดกล่องกลางประโยคได้ ถ้าตัดตามดื้อๆ จะได้บรรทัดคำเดียวโดดบนจอ)
            # ...และไม่ตัดถ้าคำแรกของกล่องถัดไปขึ้นต้นบรรทัดไม่ได้ (กล่อง CapCut ขึ้นต้นด้วย
            # "นะครับ" ได้บ่อย — ตัดตรงนั้นคือทิ้งคำลงท้ายไว้หัวบรรทัดใหม่ ซึ่งผิดกฎข้อ 8)
            if cur and not cant_lead(tk) and (curlen() >= MINLEN or (st - last) > gap):
                flush()
            brk.pop(0)

        # ตัดก่อนคำเชื่อมขึ้นประโยคใหม่ — แต่ไม่ตัดถ้าบรรทัดจะจบด้วยคำต้องห้าม
        if cur and curlen() >= MINLEN and tk in STARTERS and not ends_badly():
            flush()

        # ตัดเมื่อยาวเกิน/เว้นช่วงนาน — ยกเว้น 3 กรณี
        #   1) คำถัดไปเป็นคำปิดประโยค (ครับ/ค่ะ/อ่ะ) → ให้เกาะปิดบรรทัดเดิม
        #   2) บรรทัดจะจบด้วยคำต้องห้าม → รับคำนี้เข้ามาก่อนแล้วค่อยตัดรอบหน้า
        #   3) คำนี้ขึ้นต้นบรรทัดใหม่ไม่ได้ (คำลงท้าย/คำอังกฤษ) → รับเข้ามาก่อน
        if cur and tk not in ENDERS and not ends_badly() and not cant_lead(tk) and (
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
    ap.add_argument("--breaks", help="ไฟล์เวลาขอบกล่องซับต้นทาง (บรรทัดละ 1 วินาที) — ตัดถ้าไม่ขัดกฎอื่น")
    ap.add_argument("--scenes", help="ไฟล์เวลารอยตัดภาพ (บรรทัดละ 1 วินาที) — ตัดเสมอ")
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
        breaks = []
        if a.breaks and pathlib.Path(a.breaks).exists():
            breaks = [float(x) for x in pathlib.Path(a.breaks).read_text().split() if x.strip()]
        scenes = []
        if a.scenes and pathlib.Path(a.scenes).exists():
            scenes = [float(x) for x in pathlib.Path(a.scenes).read_text().split() if x.strip()]
        lines = group_v2(words, a.maxchars, a.gap, breaks, scenes)

    for st, en, tx in lines:
        print(f"{st + a.offset:.3f}\t{en + a.offset:.3f}\t{tx}")


if __name__ == "__main__":
    main()
