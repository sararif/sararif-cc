#!/usr/bin/env bun
/**
 * check.ts — ตรวจคลิปว่าผิดกฎ "hook & holding" ตรงไหน  (อ่านอย่างเดียว ไม่แตะไฟล์)
 *
 * ใช้ได้ทั้งก่อนตัดและหลังตัด — มันดูสถานะจริงของโปรเจกต์แล้วบอกเอง
 *   ก่อนตัด  → บอกว่ามีช่วงเงียบกี่จุด ควรตัดอะไรออก คลิปยาวเกินไหม
 *   หลังตัด  → เช็คว่างานที่ทำเสร็จแล้วผ่านฟอร์แมตไหม เหลืออะไรต้องแก้ด้วยมือ
 *
 * ใช้:
 *   bun check.ts <โปรเจกต์>
 *   bun check.ts <โปรเจกต์> --track 3     เลือกแทร็กซับที่ใช้เป็นตัวคำพูด
 *
 * เกณฑ์ทั้งหมดมาจาก ~/.sararif-cc/format.json — ไม่ถูกใจก็แก้ได้ (bun setup.ts)
 *
 * ปลอดภัย 100% — ไม่เขียนอะไรลงโปรเจกต์เลย เปิด CapCut ค้างไว้ก็รันได้
 */
import { readFileSync } from "node:fs";
import { loadDraft, videoTracks, textTracks, die, US } from "./lib/draft";
import { loadFormat } from "./lib/format";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : null;
};
const PROJ = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!PROJ || argv.includes("--help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
  process.exit(PROJ ? 0 : 1);
}

const F = loadFormat();
const draft = loadDraft(PROJ);

// ── รวบรวมข้อมูลจากโปรเจกต์ ──────────────────────────────────────────
const vt = videoTracks(draft);
if (!vt.length) die("โปรเจกต์นี้ไม่มีคลิปวิดีโอบนไทม์ไลน์");
const vsegs = [...(vt[0].segments || [])].sort(
  (a, b) => (a.target_timerange?.start || 0) - (b.target_timerange?.start || 0));
const clipEnd = Math.max(...vsegs.map((s) =>
  ((s.target_timerange?.start || 0) + (s.target_timerange?.duration || 0)) / US));

const texts: Record<string, any> = {};
for (const m of draft.materials?.texts || []) texts[m.id] = m;
const textOf = (seg: any) => {
  try {
    return (JSON.parse(texts[seg.material_id]?.content || "{}").text || "").replace(/\s+/g, " ").trim();
  } catch { return ""; }
};

const candidates = (draft.tracks || [])
  .map((t: any, idx: number) => ({ t, idx }))
  .filter((x: any) => x.t.type === "text" && (x.t.segments || []).length);
if (!candidates.length) {
  die(`โปรเจกต์นี้ยังไม่มีซับ — ตัวตรวจใช้ซับเป็นตัวอ่านว่าพูดอะไรตอนไหน
   เปิด CapCut → Text → Auto captions (ภาษาไทย) → ปิด CapCut → รันใหม่`);
}
const trackFlag = flag("track");
const picked = trackFlag
  ? candidates.find((c: any) => String(c.idx) === trackFlag)
    ?? die(`ไม่มีแทร็กเลข ${trackFlag} — เลขที่ใช้ได้: ${candidates.map((c: any) => c.idx).join(", ")}`)
  : candidates.reduce((a: any, b: any) => (b.t.segments.length > a.t.segments.length ? b : a));

type Line = { st: number; en: number; text: string };
const lines: Line[] = (picked.t.segments || [])
  .map((s: any) => ({
    st: (s.target_timerange?.start || 0) / US,
    en: ((s.target_timerange?.start || 0) + (s.target_timerange?.duration || 0)) / US,
    text: textOf(s),
  }))
  .filter((l: Line) => l.text)
  .sort((a: Line, b: Line) => a.st - b.st);

// ── ตัวช่วย ───────────────────────────────────────────────────────────
const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const findings: { level: "warn" | "info"; msg: string }[] = [];
const passed: string[] = [];
const warn = (m: string) => findings.push({ level: "warn", msg: m });
const info = (m: string) => findings.push({ level: "info", msg: m });

/** ความคล้ายของข้อความ 2 ก้อน แบบนับตัวอักษรติดกัน 3 ตัว (0-1) */
function similar(a: string, b: string) {
  const grams = (s: string) => {
    const x = s.replace(/\s/g, "");
    return new Set(Array.from({ length: Math.max(0, x.length - 2) }, (_, i) => x.slice(i, i + 3)));
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

// ── 1. ความยาวคลิป ───────────────────────────────────────────────────
if (clipEnd > F.clipSeconds.max) {
  warn(`คลิปยาว ${clipEnd.toFixed(0)} วิ — เกินเป้า ${F.clipSeconds.max} วิ
     คลิปยาวคนเลื่อนผ่านกลางทาง ตัดให้เหลือแต่ท่อนที่จำเป็น
     ถ้าคลิปคุณเป็นสายสอนที่ต้องยาว ก็แก้ clipSeconds ในไฟล์ตั้งค่าได้`);
} else if (clipEnd < F.clipSeconds.min) {
  info(`คลิปสั้น ${clipEnd.toFixed(0)} วิ — ต่ำกว่าเป้า ${F.clipSeconds.min} วิ (ไม่ผิด แค่บอกให้รู้)`);
} else {
  passed.push(`ความยาว ${clipEnd.toFixed(0)} วิ อยู่ในเป้า ${F.clipSeconds.min}-${F.clipSeconds.max} วิ`);
}

// ── 2. แนะนำตัวหัวคลิป ───────────────────────────────────────────────
const INTRO = ["สวัสดี", "ผมชื่อ", "ดิฉัน", "ยินดีต้อนรับ", "วันนี้ผมจะ", "วันนี้จะพา", "วันนี้จะมา", "ก่อนอื่น"];
const head = lines.filter((l) => l.st < F.checks.introSeconds);
const introHit = head.filter((l) => INTRO.some((p) => l.text.includes(p)));
if (introHit.length) {
  warn(`${F.checks.introSeconds} วิแรกเป็นการแนะนำตัว — ลองตัดทิ้ง คนยังไม่สนใจว่าคุณเป็นใคร
     ${introHit.slice(0, 2).map((l) => `${t(l.st)}  "${l.text}"`).join("\n     ")}`);
} else if (head.length) {
  passed.push("เปิดคลิปไม่ได้เผาเวลาไปกับการแนะนำตัว");
}

// ── 3. ช่วงเงียบ (ตรงนี้คือตัวบอกว่ายังไม่ได้ตัด หรือตัดแล้ว) ────────
// เกณฑ์ต้องตรงกับที่ cut.ts ตัดจริง — cut.ts เผื่อหัว/ท้ายไว้ แล้วไม่ตัดช่องที่สั้นกว่า gap
// ถ้าตรวจด้วย gap เปล่าๆ มันจะฟ้องช่องที่ cut.ts ตั้งใจเก็บไว้ (กันคลิปกระตุกเป็นห้วนๆ)
const SILENCE_MIN = F.silence.gap + F.silence.head + F.silence.tail;
const gaps: [number, number][] = [];
if (lines[0] && lines[0].st > SILENCE_MIN) gaps.push([0, lines[0].st]);
for (let i = 1; i < lines.length; i++) {
  const g = lines[i].st - lines[i - 1].en;
  if (g > SILENCE_MIN) gaps.push([lines[i - 1].en, lines[i].st]);
}
const lastEnd = lines.length ? lines[lines.length - 1].en : 0;
if (clipEnd - lastEnd > SILENCE_MIN) gaps.push([lastEnd, clipEnd]);

const silentTotal = gaps.reduce((n, [a, b]) => n + (b - a), 0);
if (gaps.length) {
  warn(`ช่วงเงียบ ${gaps.length} จุด รวม ${silentTotal.toFixed(1)} วิ — สั่ง  bun cut.ts ${PROJ}  ตัดให้ได้
     ${gaps.slice(0, 4).map(([a, b]) => `${t(a)}–${t(b)}  (${(b - a).toFixed(1)} วิ)`).join("  ·  ")}${gaps.length > 4 ? `  · อีก ${gaps.length - 4} จุด` : ""}`);
} else {
  passed.push("ไม่มีช่วงเงียบค้าง (ตัดแล้ว)");
}

// ── 4. รอยตัดที่ผ่ากลางประโยค ────────────────────────────────────────
// เผื่อ 0.5 วิ เพราะเวลาของแต่ละคำมาจากการ "เฉลี่ยตามจำนวนตัวอักษร" ในกล่องซับ
// ไม่ใช่เวลาจริงรายคำ — คำเดียวคร่อมรอยตัดไป 0.2-0.3 วิ เป็นเรื่องปกติ ไม่ใช่การตัดผิด
// ที่ต้องจับคือประโยคทั้งท่อนพาดผ่านรอยตัด ซึ่งคนดูเห็นชัด
const CUT_TOLERANCE = 0.5;
const cutPoints = vsegs.slice(1).map((s: any) => (s.target_timerange?.start || 0) / US);
const midCuts = cutPoints
  .map((cp) => ({ cp, line: lines.find((l) => l.st < cp - CUT_TOLERANCE && l.en > cp + CUT_TOLERANCE) }))
  .filter((x) => x.line);
if (midCuts.length) {
  warn(`รอยตัด ${midCuts.length} จุดผ่ากลางประโยค — ทุกรอยตัดควรเป็นจุดที่ความคิดจบ
     ${midCuts.slice(0, 3).map((x) => `${t(x.cp)}  ตัดกลาง "${x.line!.text}"`).join("\n     ")}`);
} else if (cutPoints.length) {
  passed.push(`รอยตัดทั้ง ${cutPoints.length} จุดอยู่ที่ขอบประโยค ไม่ผ่ากลาง`);
}

// ── 5. พูดเรื่องเดิมซ้ำ ───────────────────────────────────────────────
// เทียบเป็น "ก้อนประโยค" ไม่ใช่บรรทัดเดี่ยว — บรรทัดซับยาวแค่ ~1 วินาที
// ชื่อคน/คำติดปากที่พูดซ้ำตามปกติจะดูเหมือนซ้ำ 100% ทั้งที่ไม่ใช่ความผิด
const BLOCK_CHARS = 40;
const blocks: Line[] = [];
for (const l of lines) {
  const last = blocks[blocks.length - 1];
  if (last && last.text.replace(/\s/g, "").length < BLOCK_CHARS) {
    last.text += l.text;
    last.en = l.en;
  } else {
    blocks.push({ ...l });
  }
}
const dup: string[] = [];
for (let i = 0; i < blocks.length && dup.length < 3; i++) {
  if (blocks[i].text.replace(/\s/g, "").length < BLOCK_CHARS) continue;
  for (let j = i + 2; j < blocks.length; j++) {
    const s = similar(blocks[i].text, blocks[j].text);
    if (s >= F.checks.repeatSimilarity) {
      dup.push(`${t(blocks[i].st)} กับ ${t(blocks[j].st)} คล้ายกัน ${(s * 100).toFixed(0)}%  "${blocks[i].text.slice(0, 44)}…"`);
      break;
    }
  }
}
if (dup.length) {
  warn(`พูดเรื่องเดียวกันซ้ำ — ตัดทิ้งอันหนึ่ง คนดูรู้สึกว่าคลิปยืดทันที\n     ${dup.join("\n     ")}`);
} else {
  passed.push("ไม่มีท่อนที่พูดเรื่องเดิมซ้ำ");
}

// ── 6. จบค้าง ────────────────────────────────────────────────────────
const HANGING = ["ที่", "ใน", "จาก", "กับ", "แล้ว", "ก็", "ซึ่ง", "แต่", "และ", "เพราะ", "ว่า", "คือ", "จะ", "ไม่"];
const tail = lines[lines.length - 1];
if (tail) {
  const lastWord = tail.text.split(/\s+/).pop() || "";
  if (HANGING.some((w) => lastWord.endsWith(w))) {
    warn(`ประโยคสุดท้ายค้าง ไม่จบความ — "${tail.text}"
     ปล่อยให้จบเต็มประโยค แล้วค้างข้อความบนจอต่ออีก 2-3 วิ ให้คนมีจังหวะคอมเมนต์`);
  } else {
    passed.push("ประโยคปิดจบความ");
  }
  if (clipEnd - tail.en < 1.5) {
    info(`คลิปจบทันทีที่พูดจบ (เหลือ ${(clipEnd - tail.en).toFixed(1)} วิ) — เผื่อท้ายไว้ 2-3 วิ ให้คนได้คิดก่อนเลื่อนผ่าน`);
  }
}

// ── 7. มี hook ตอนต้นไหม ─────────────────────────────────────────────
const otherText = candidates.filter((c: any) => c.idx !== picked.idx);
const hasHook = otherText.some((c: any) =>
  (c.t.segments || []).some((s: any) => (s.target_timerange?.start || 0) / US < 3 && textOf(s)));
if (hasHook) passed.push("มีข้อความ hook ช่วงต้นคลิป");
else warn(`ไม่มีข้อความ hook ช่วง 3 วิแรก — คนเลื่อนฟีดตัดสินใจภายใน 1-2 วิ
     สั่ง  bun hook.ts ${PROJ} --l1 "..." --l2 "..."  ใส่ได้`);

// ── 8. ซับยาวเกินบรรทัด ──────────────────────────────────────────────
const longLines = lines.filter((l) => l.text.replace(/\s/g, "").length > F.subtitle.maxchars * 1.5);
if (longLines.length) {
  warn(`ซับ ${longLines.length} บรรทัดยาวเกินไป (เกิน ${Math.round(F.subtitle.maxchars * 1.5)} ตัว) — ล้นเฟรมบนมือถือ
     สั่ง  bun cc.ts ${PROJ}  แบ่งบรรทัดใหม่ได้
     ${longLines.slice(0, 2).map((l) => `${t(l.st)}  "${l.text.slice(0, 40)}…"`).join("\n     ")}`);
} else {
  passed.push(`ซับทุกบรรทัดยาวพอดี (ไม่เกิน ${Math.round(F.subtitle.maxchars * 1.5)} ตัว)`);
}

// ── รายงาน ───────────────────────────────────────────────────────────
console.log(`\n🔎 ตรวจ "${PROJ}"  ·  ${clipEnd.toFixed(0)} วินาที  ·  ซับ ${lines.length} บรรทัด  ·  ${vsegs.length} ท่อน\n`);

const warns = findings.filter((f) => f.level === "warn");
const infos = findings.filter((f) => f.level === "info");

if (warns.length) {
  console.log(`ต้องแก้ ${warns.length} เรื่อง\n`);
  for (const f of warns) console.log(`  ⚠️  ${f.msg}\n`);
}
if (infos.length) {
  for (const f of infos) console.log(`  ℹ️  ${f.msg}\n`);
}
if (passed.length) {
  console.log("ผ่านแล้ว");
  for (const p of passed) console.log(`  ✅ ${p}`);
  console.log();
}

console.log(warns.length
  ? `สรุป: ผ่าน ${passed.length} · ต้องแก้ ${warns.length}\n`
  : `สรุป: ผ่านทุกข้อ (${passed.length} ข้อ) — เอาไปลงได้เลย\n`);
console.log(`เกณฑ์พวกนี้ปรับได้ที่ ~/.sararif-cc/format.json  (bun setup.ts --show)\n`);
