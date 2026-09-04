#!/usr/bin/env bun
/**
 * cut.ts — ตัดช่วงเงียบออกจากคลิปอัตโนมัติ แล้ววางคลิปต่อกันแบบไม่มีช่องว่าง
 *
 * ใช้ "กล่องซับที่ CapCut ถอดไว้แล้ว" เป็นตัวบอกว่าช่วงไหนมีคนพูด — ฟรี ไม่ต้องถอดเสียงใหม่
 * ช่วงที่ไม่มีกล่องซับคลุม = ไม่มีใครพูด = ตัดทิ้ง (ช่วงตั้งกล้อง เดินไปเดินมา เงียบยาว)
 *
 * ซับเดิมถูกเลื่อนเวลาตามให้ด้วย ไม่ได้ลบทิ้ง → รัน `bun cc.ts <proj>` ต่อได้เลย
 *
 * ใช้:
 *   bun cut.ts <โปรเจกต์> --dry            ดูก่อนว่าจะตัดอะไรออกบ้าง
 *   bun cut.ts <โปรเจกต์>                  ตัดจริง
 *   bun cut.ts <โปรเจกต์> --track 3        เลือกแทร็กซับที่จะใช้เป็นตัวจับเสียงพูด
 *
 * ตัวเลือก:
 *   --head 0.20      เผื่อเวลาก่อนเริ่มพูด (วินาที)
 *   --tail 0.40      เผื่อเวลาหลังพูดจบ
 *   --gap 0.60       ช่องเงียบสั้นกว่านี้ไม่ตัด (กันคลิปกระตุกเป็นห้วนๆ)
 *   --min 0.30       ท่อนที่สั้นกว่านี้ทิ้งไป
 *
 * ⚠️ ปิด CapCut ก่อนรัน. สำรองไฟล์เดิมเป็น .PRE_CUT_BAK
 */
import { readFileSync } from "node:fs";
import { loadDraft, saveDraft, requireCapCutClosed, videoTracks, textTracks, clipName, die, US } from "./lib/draft";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n: string) => argv.includes(`--${n}`);
const PROJ = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && argv[i - 1] !== "--dry"));

if (!PROJ || has("help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
  process.exit(PROJ ? 0 : 1);
}

const HEAD = parseFloat(flag("head", "0.20"));
const TAIL = parseFloat(flag("tail", "0.40"));
const GAP = parseFloat(flag("gap", "0.60"));
const MIN = parseFloat(flag("min", "0.30"));
const DRY = has("dry");

const draft = loadDraft(PROJ);

// ── 1. หาแทร็กซับที่จะใช้เป็น "ตัวบอกว่าพูดตอนไหน" ───────────────────
const withRows = (draft.tracks || [])
  .map((t: any, idx: number) => ({ t, idx }))
  .filter((x: any) => x.t.type === "text" && (x.t.segments || []).length > 0);

if (!withRows.length) {
  die(`โปรเจกต์นี้ยังไม่มีซับเลย — cut.ts ใช้ซับเป็นตัวจับว่าใครพูดตอนไหน
   เปิด CapCut → เลือกคลิป → Text → Auto captions (ภาษาไทย) → ปิด CapCut → รันใหม่`);
}

const trackFlag = flag("track", "");
let picked = withRows[0];
if (trackFlag) {
  const f = withRows.find((x: any) => String(x.idx) === trackFlag);
  if (!f) die(`ไม่มีแทร็กเลข ${trackFlag} — เลขที่ใช้ได้: ${withRows.map((x: any) => x.idx).join(", ")}`);
  picked = f;
} else if (withRows.length > 1) {
  // เลือกแทร็กที่มีกล่องเยอะสุด = แทร็กคำพูด (ไม่ใช่แทร็กไตเติล/hook ที่มีไม่กี่กล่อง)
  picked = withRows.reduce((a: any, b: any) =>
    (b.t.segments.length > a.t.segments.length ? b : a));
  console.log(`ℹ️ มีข้อความหลายแทร็ก เลือกแทร็ก ${picked.idx} (${picked.t.segments.length} กล่อง) เป็นตัวจับเสียงพูด`);
  console.log(`   ไม่ใช่ตัวนี้ → เติม --track <เลข> จาก: ${withRows.map((x: any) => `${x.idx}(${x.t.segments.length})`).join(" · ")}`);
}

// ── 2. รวมกล่องซับเป็น "ช่วงที่มีคนพูด" บนไทม์ไลน์ ────────────────────
const raw = picked.t.segments
  .map((s: any) => {
    const r = s.target_timerange || {};
    return [(r.start || 0) / US - HEAD, ((r.start || 0) + (r.duration || 0)) / US + TAIL] as [number, number];
  })
  .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);

const speech: [number, number][] = [];
for (const [s, e] of raw) {
  const last = speech[speech.length - 1];
  if (last && s - last[1] < GAP) last[1] = Math.max(last[1], e);
  else speech.push([Math.max(0, s), e]);
}

// ── 3. ตัดแต่ละ segment วิดีโอให้เหลือเฉพาะช่วงที่มีเสียงพูด ──────────
const vtracks = videoTracks(draft);
if (!vtracks.length) die("โปรเจกต์นี้ไม่มีคลิปวิดีโอบนไทม์ไลน์");

type Piece = { seg: any; tlStart: number; tlEnd: number; srcStart: number };
const pieces: Piece[] = [];
let keptFrom = 0;

for (const seg of vtracks[0].segments || []) {
  const tr = seg.target_timerange || {};
  const a = (tr.start || 0) / US;
  const b = a + (tr.duration || 0) / US;
  const src = (seg.source_timerange?.start || 0) / US;
  const rate = (tr.duration || 1) === 0 ? 1 : (seg.source_timerange?.duration || tr.duration || 1) / (tr.duration || 1);
  keptFrom += b - a;
  for (const [s, e] of speech) {
    const lo = Math.max(a, s), hi = Math.min(b, e);
    if (hi - lo < MIN) continue;
    const last = pieces[pieces.length - 1];
    // ท่อนที่ต่อกันสนิทในคลิปเดียวกัน = รวมเป็นท่อนเดียว ไม่ต้องหั่นเพิ่มให้ไทม์ไลน์รก
    if (last && last.seg === seg && lo - last.tlEnd < 1e-6) {
      last.tlEnd = Math.max(last.tlEnd, hi);
      continue;
    }
    pieces.push({ seg, tlStart: lo, tlEnd: hi, srcStart: src + (lo - a) * rate });
  }
}

if (!pieces.length) die("ตัดแล้วไม่เหลืออะไรเลย — ลองเพิ่ม --gap หรือเช็คว่าซับตรงกับคลิปไหม");

const keptTo = pieces.reduce((n, p) => n + (p.tlEnd - p.tlStart), 0);
const saved = keptFrom - keptTo;

console.log(`\n✂️  ${PROJ}`);
console.log(`   คลิปเดิม ${keptFrom.toFixed(1)} วิ → เหลือ ${keptTo.toFixed(1)} วิ · ตัดออก ${saved.toFixed(1)} วิ (${(saved / keptFrom * 100).toFixed(0)}%)`);
console.log(`   แบ่งเป็น ${pieces.length} ท่อน จาก ${(vtracks[0].segments || []).length} คลิป\n`);

// map เวลาเก่า → เวลาใหม่ (ใช้เลื่อนซับตามด้วย)
let cursor = 0;
const remap: { from: number; to: number; at: number }[] = [];
for (const p of pieces) {
  remap.push({ from: p.tlStart, to: p.tlEnd, at: cursor });
  cursor += p.tlEnd - p.tlStart;
}
const newTime = (t: number): number | null => {
  for (const r of remap) if (t >= r.from - 1e-6 && t <= r.to + 1e-6) return r.at + (t - r.from);
  return null;
};

if (DRY) {
  console.log("👀 โหมด --dry: ยังไม่แตะโปรเจกต์ — ช่วงที่จะเก็บไว้:\n");
  for (const p of pieces.slice(0, 25)) {
    console.log(`   ${p.tlStart.toFixed(1).padStart(7)}s → ${p.tlEnd.toFixed(1).padStart(7)}s   (${(p.tlEnd - p.tlStart).toFixed(1)} วิ)  ${clipName(draft, p.seg)}`);
  }
  if (pieces.length > 25) console.log(`   … อีก ${pieces.length - 25} ท่อน`);
  console.log(`\n✅ เอา --dry ออกแล้วรันใหม่เพื่อตัดจริง\n`);
  process.exit(0);
}

await requireCapCutClosed();

// ── ตัดทุกแทร็กที่วางของไว้บนไทม์ไลน์ ────────────────────────────────
// 🐛 รอบแรกตัดแค่แทร็กวิดีโอแรก → b-roll แทร็ก 2 กับเสียงยังใช้เวลาเดิม = หลุดซิงค์ทั้งคลิป
//    (เจอตอนอ่านผลกลับ 4 ก.ย. 69) ตัดไทม์ไลน์ = ต้องตัดทุกอย่างที่อยู่บนไทม์ไลน์
const kept: [number, number][] = pieces.map((p) => [p.tlStart, p.tlEnd]);

function cutTrack(track: any): number {
  const out: any[] = [];
  for (const seg of track.segments || []) {
    const tr = seg.target_timerange || {};
    const a = (tr.start || 0) / US;
    const b = a + (tr.duration || 0) / US;
    const srcA = (seg.source_timerange?.start || 0) / US;
    const rate = seg.source_timerange && (tr.duration || 0) > 0
      ? (seg.source_timerange.duration || tr.duration) / tr.duration
      : 1;
    for (const [ks, ke] of kept) {
      const lo = Math.max(a, ks), hi = Math.min(b, ke);
      if (hi - lo < 0.02) continue;
      const s = JSON.parse(JSON.stringify(seg));
      s.id = crypto.randomUUID().toUpperCase();
      const at = newTime(lo);
      if (at === null) continue;
      s.target_timerange = { start: Math.round(at * US), duration: Math.round((hi - lo) * US) };
      if (s.source_timerange) {
        s.source_timerange = {
          start: Math.round((srcA + (lo - a) * rate) * US),
          duration: Math.round((hi - lo) * rate * US),
        };
      }
      out.push(s);
    }
  }
  track.segments = out;
  return out.length;
}

const cutTracks = (draft.tracks || []).filter((t: any) => (t.type === "video" || t.type === "audio") && (t.segments || []).length);
const cutCounts = cutTracks.map((t: any) => `${t.type} ${cutTrack(t)} ท่อน`);

// เลื่อนซับตามเวลาใหม่ — กล่องที่ตกอยู่ในช่วงที่ถูกตัดออกก็หายไปด้วย
let moved = 0, dropped = 0;
for (const tt of textTracks(draft)) {
  const keep: any[] = [];
  for (const s of tt.segments || []) {
    const r = s.target_timerange || {};
    const st = newTime((r.start || 0) / US);
    if (st === null) { dropped++; continue; }
    const en = newTime(((r.start || 0) + (r.duration || 0)) / US);
    s.target_timerange = {
      start: Math.round(st * US),
      duration: Math.round(Math.max(0.1, (en ?? st + (r.duration || 0) / US) - st) * US),
    };
    keep.push(s); moved++;
  }
  tt.segments = keep;
}

// แทร็กชนิดอื่น (สติกเกอร์/เอฟเฟกต์) ที่ยังอ้างเวลาเดิม = จะเพี้ยน เตือนไว้ตรงๆ
const others = (draft.tracks || []).filter(
  (t: any) => !["video", "audio", "text"].includes(t.type) && (t.segments || []).length);

const res = await saveDraft(PROJ, draft, "PRE_CUT_BAK");
console.log(`✅ ตัดเสร็จ — ${cutCounts.join(" · ")} · เลื่อนซับตาม ${moved} กล่อง (ตกช่วงที่ตัดออก ${dropped} กล่อง)`);
console.log(`   sync Timelines ${res.synced} ไฟล์ · สำรอง .PRE_CUT_BAK`);
if (others.length) {
  console.log(`\n⚠️ มีแทร็ก ${others.map((t: any) => t.type).join("/")} อีก ${others.length} แทร็ก ที่ยังใช้เวลาเดิม — ต้องขยับเองใน CapCut`);
}
console.log(`\n👉 ต่อด้วย  bun cc.ts ${PROJ}  เพื่อแบ่งบรรทัดซับใหม่ให้ตรงกับที่ตัดแล้ว\n`);
