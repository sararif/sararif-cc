#!/usr/bin/env python3
"""
make_subs.py — STT (char timings) → ASS subtitle ที่ตัด "ครบคำ" ด้วย pythainlp
- ตัดคำจริงด้วย pythainlp newmm (ไม่ตัดกลางคำ)
- แก้คำผิดที่ STT ได้ยินเพี้ยน (สาละรีฟ/สาระลีฟ → สาระรีฟ ฯลฯ)
- map แต่ละคำกลับไป timing รายตัวอักษรจาก STT → sync แม่น

Usage:
  python3 make_subs.py stt_words.json out.ass [--offset SEC] [--maxchars 20] [--gap 0.4]
"""
import json, sys, argparse, re
from pythainlp.tokenize import word_tokenize
from pythainlp.util import dict_trie
from pythainlp.corpus.common import thai_words

# คำยืมภาษาอังกฤษ + คำเฉพาะที่ Sararif ใช้บ่อย (pythainlp ไม่รู้จัก → ตัดกลางคำ)
LOANWORDS = {
    "เทรน","เทรนด์","ไลฟ์","คลิป","รีวิว","โฟลเดอร์","ไฟล์","แบต","แบตหลอก","ครีเอเตอร์",
    "สกรีน","คอนเทนต์","โซโลพรีเนอร์","แอร์ดรอป","ซับ","เอฟเฟกต์","ออนไลน์","โพสต์","เอไอ",
    "พานาโซนิค","ลูมิกซ์","พรีเมียม","สาระรีฟ","คู่ค้า","อีคอมเมิร์ซ","ดิจิตอล","แคปชัน",
}
CUSTOM_DICT = dict_trie(set(thai_words()) | LOANWORDS)

# แก้คำผิดจาก STT — apply_fix รองรับความยาวไม่เท่าแล้ว (rebuild timing ให้ช่วงที่แทน)
# 🚨 ชื่อแบรนด์ "สาระรีฟ"/"Sararif" ห้ามผิดเด็ดขาด — STT ได้ยินเพี้ยนบ่อย ใส่ทุกแบบที่เคยเจอ
FIX = {
    "สาละรีฟ":"สาระรีฟ", "สาระลีฟ":"สาระรีฟ", "สาระลิฟ":"สาระรีฟ", "สาละลีฟ":"สาระรีฟ",
    "Saralize":"สาระรีฟ", "Sararize":"สาระรีฟ", "Saralise":"สาระรีฟ", "ซาราไลซ์":"สาระรีฟ",
    "สารีฟ":"สาระรีฟ", "สาระริฟ":"สาระรีฟ",
    "สาระลิต":"สาระรีฟ", "สาระลิด":"สาระรีฟ",   # เจอ 10 ส.ค. 69 (คลิป AI iPhone 0810)
    "โรตีมาริซ่า":"โรตีมาลีซ่า", "มาริซ่า":"มาลีซ่า", "มาลิสา":"มาลีซ่า",   # ร้านโรตีมาลีซ่า (10 ส.ค. 69)
    "Salalib":"สาระรีฟ", "Salaleep":"สาระรีฟ", "Salalip":"สาระรีฟ",
    "สาระรีฟต์":"สาระรีฟ", "สาระรีบ":"สาระรีฟ",
    "Salalite":"สาระรีฟ", "สาระรี้ฟ":"สาระรีฟ", "สาระรี๊ฟ":"สาระรีฟ", "สาระรีฝ":"สาระรีฟ",
    # ร้านบังไลท์ สาขา 2 (STT ได้ยิน "บางไล้/บังไร้/สาขาสอง")
    "บางไล้":"บังไลท์", "บางไลท์":"บังไลท์", "บังไล้":"บังไลท์", "บังไร้":"บังไลท์", "บังไร":"บังไลท์", "สาขาสอง":"สาขา2",
    # บางกล่ำ สงขลา (STT ได้ยิน "บางกะมป์/บางกำ")
    "บางกะมป์":"บางกล่ำ", "บางกะม":"บางกล่ำ", "บางกำ":"บางกล่ำ",
    # Halal Travel pillar — STT ได้ยิน "ฮาลาล" เพี้ยนบ่อย
    "หะล้า":"ฮาลาล", "หะลาล":"ฮาลาล", "ฮะล้า":"ฮาลาล", "หะล่า":"ฮาลาล",
    "เบสใหญ่":"เบดใหญ่", "แบบพาร้าน":"แบบฮาลาล",
}

def fmt(t):
    t = max(0, t); h=int(t//3600); m=int((t%3600)//60); s=t%60
    return f"{h:d}:{m:02d}:{s:05.2f}"

def load_chars(stt):
    """คืน (full_text, [(start,end) ต่อ 1 ตัวอักษร])"""
    d = json.load(open(stt))
    S, T = [], []
    STRIP = set("-–—_*")  # ตัด artifact จาก STT (false-start ฯลฯ)
    for w in d.get("words", []):
        # ข้าม audio_event (เช่น "[เสียงคลิกเมาส์]", "[ดนตรี]") — เป็น tag เสียง ไม่ใช่คำพูด ไม่ควรขึ้นซับ
        if w.get("type") == "audio_event":
            continue
        txt = w.get("text") or ""; st, en = w.get("start"), w.get("end")
        if not txt or st is None or en is None:
            continue
        for ch in txt:
            if ch in STRIP:
                continue
            S.append(ch); T.append((st, en))
    return "".join(S), T

def apply_fix(text, times):
    for bad, good in FIX.items():
        i = text.find(bad)
        while i != -1:
            if len(bad) == len(good):
                text = text[:i] + good + text[i+len(bad):]
            else:
                # ยาวไม่เท่า → กระจายเวลาของช่วงคำเดิมให้ตัวอักษรใหม่ (timing ไม่เลื่อน)
                span = times[i:i+len(bad)]
                st, en = span[0][0], span[-1][1]; n = len(good)
                new_t = [(st + (en-st)*k/n, st + (en-st)*(k+1)/n) for k in range(n)]
                text = text[:i] + good + text[i+len(bad):]
                times = times[:i] + new_t + times[i+len(bad):]
            # หา bad ตัวถัดไป (เริ่มหลัง good ที่เพิ่งใส่ กัน loop) — แบรนด์ที่พูดซ้ำต้องแก้ครบทุกครั้ง
            i = text.find(bad, i+len(good))
    return text, times

# คำที่ต้องรวมเป็นก้อนเดียว (สไตล์การพูด Sararif) — ห้ามแยกข้ามบรรทัด
# คำที่ต้องรวมก้อน (ความหมายเปลี่ยนถ้าแยก เช่น สาระ+รีฟ, คู่+ค้า)
MERGE = [("นะ","ครับ"), ("นะ","คะ"), ("นี่","คือ"), ("ก็","คือ"),
         ("สาระ","รีฟ"), ("คู่","ค้า"), ("ไม่","ได้"), ("ไม่ได้","ง่าย")]

def words_with_time(text, times):
    """tokenize แล้ว map แต่ละคำกลับไป timing ตามตำแหน่งตัวอักษร"""
    toks = word_tokenize(text, engine="newmm", keep_whitespace=False, custom_dict=CUSTOM_DICT)
    out, pos = [], 0
    for tk in toks:
        j = text.find(tk, pos)
        if j == -1:
            continue
        st = times[j][0]; en = times[j+len(tk)-1][1]
        out.append((tk, st, en)); pos = j + len(tk)
    return merge_bigrams(out)

def merge_bigrams(words):
    changed = True
    while changed:                      # วนจน merge ครบ (รองรับก้อนซ้อน เช่น ไม่+ได้+ง่าย)
        changed, out, i = False, [], 0
        while i < len(words):
            if i+1 < len(words) and (words[i][0], words[i+1][0]) in MERGE:
                a, b = words[i], words[i+1]
                out.append((a[0]+b[0], a[1], b[2])); i += 2; changed = True
            else:
                out.append(words[i]); i += 1
        words = out
    return words

# ตัด CC ให้ตามจบประโยค — ครับ/ค่ะ = จบ (ตัดหลัง), ก็/ซึ่ง/แต่ = คำขึ้นประโยคใหม่ (ตัดก่อน)
# คำปิดประโยคสไตล์ Sararif: ครับ/ค่ะ/อะ/เนี่ย/ปุ๊บ + นะครับ(ก้อน)
ENDERS   = {"ครับ","ค่ะ","คะ","จ้า","ครับผม","นะครับ","นะคะ","อะ","อ่ะ",
            "เนี่ย","เนี้ย","ปุ๊บ","ปุ้บ"}
# คำขึ้นประโยคใหม่ (เอา "แล้ว" ออก เพราะกำกวม เช่น โดนค่าปรับไปแล้ว)
STARTERS = {"ก็","ซึ่ง","แต่","เพราะ","ดังนั้น","พอ","ถ้า","เพราะฉะนั้น","นี่คือ","ก็คือ"}
MINLEN = 8   # อย่าตัดจนบรรทัดสั้นเกิน

def group(words, maxchars, gap):
    lines, cur, start, last = [], [], None, None
    def curlen(): return sum(len(x) for x in cur)
    def is_foreign(t):  # คำยืม/ทับศัพท์ หรือมีตัวอักษรอังกฤษ
        return t in LOANWORDS or bool(re.search(r"[A-Za-z]", t))
    def smart_join(toks):  # เว้นวรรครอบคำอังกฤษ/ทับศัพท์ ให้ดูสะอาด
        out = ""
        for i, t in enumerate(toks):
            if i > 0 and (is_foreign(t) or is_foreign(toks[i-1])):
                out += " "
            out += t
        return out.strip()
    def flush():
        nonlocal cur, start, last
        if cur: lines.append((start, last, smart_join(cur)))
        cur, start, last = [], None, None
    for tk, st, en in words:
        # ตัด "ก่อน" คำเชื่อม (ก็/ซึ่ง/แต่...) ถ้าบรรทัดยาวพอ → คำเชื่อมไปนำประโยคใหม่
        if cur and curlen() >= MINLEN and tk in STARTERS:
            flush()
        # ตัดเมื่อเกิน maxchars/เว้นช่วงนาน — แต่ห้ามตัด "ก่อน" คำปิดประโยค (ให้เกาะปิดบรรทัดเดิม)
        if cur and tk not in ENDERS and (curlen()+len(tk) > maxchars or (st-last) > gap):
            flush()
        if not cur: start = st
        cur.append(tk); last = en
        # ตัด "หลัง" คำจบประโยค (ครับ/ค่ะ/อะ/นะครับ) เสมอ — สไตล์การพูด Sararif
        if tk in ENDERS and cur:
            flush()
    flush()
    return lines

HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{font},70,&H00FFFFFF,&H00000000,&H90000000,1,5,2,2,70,70,300,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

def main():
    p = argparse.ArgumentParser()
    p.add_argument("stt"); p.add_argument("out")
    p.add_argument("--offset", type=float, default=0.0)
    p.add_argument("--maxchars", type=int, default=20)
    p.add_argument("--gap", type=float, default=0.4)
    p.add_argument("--font", default="Sukhumvit Set")
    p.add_argument("--words-json", metavar="PATH",
                   help="export timing ระดับคำ (ก่อน group เป็นวลี) → ให้ capcut_karaoke.ts กินต่อ")
    p.add_argument("--karaoke", action="store_true",
                   help="โหมดซับคำต่อคำ (1 คำ/Dialogue, fill-to-next) แทน phrase")
    p.add_argument("--kw", default="", help="คำ keyword เหลือง คั่นด้วย , (ใช้กับ --karaoke)")
    p.add_argument("--hold", type=float, default=0.4, help="ค้างคำสุดท้าย (วิ)")
    a = p.parse_args()
    text, times = load_chars(a.stt)
    text, times = apply_fix(text, times)
    words = words_with_time(text, times)
    if a.words_json:
        payload = [{"word": w, "start": round(st + a.offset, 3), "end": round(en + a.offset, 3)}
                   for w, st, en in words]
        json.dump(payload, open(a.words_json, "w"), ensure_ascii=False, indent=1)
        print(f"✅ {len(payload)} คำ (word-level) → {a.words_json}")
    if a.karaoke:
        kw = {k.strip().lower() for k in a.kw.split(",") if k.strip()}
        YEL = r"{\c&H00D6FF&}"  # ASS = &HBBGGRR → เหลือง #FFD600
        WHT = r"{\c&HFFFFFF&}"
        out = [HEADER.format(font=a.font)]
        n = len(words)
        for i, (w, st, en) in enumerate(words):
            nxt = words[i + 1][1] if i + 1 < n else en + a.hold  # fill ถึงคำถัดไป
            dur_end = nxt
            txt = (YEL + w + WHT) if w.lower() in kw else w
            out.append(f"Dialogue: 0,{fmt(st+a.offset)},{fmt(dur_end+a.offset)},Sub,,0,0,0,,{txt}")
        open(a.out, "w").write("\n".join(out))
        hit = sum(1 for w, _, _ in words if w.lower() in kw)
        print(f"✅ karaoke {n} คำ ({hit} เหลือง) → {a.out}")
        return
    lines = group(words, a.maxchars, a.gap)
    out = [HEADER.format(font=a.font)]
    for st, en, txt in lines:
        out.append(f"Dialogue: 0,{fmt(st+a.offset)},{fmt(en+a.offset)},Sub,,0,0,0,,{txt}")
    open(a.out, "w").write("\n".join(out))
    print(f"✅ {len(lines)} บรรทัด (ตัดครบคำ) → {a.out}")

if __name__ == "__main__":
    main()
