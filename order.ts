#!/usr/bin/env bun
/**
 * order.ts — เรียงลำดับคลิปบนไทม์ไลน์ใหม่ แล้ววางต่อกันแบบไม่มีช่องว่าง
 *
 * 2 แบบ:
 *   อัตโนมัติ  เรียงตามเลขในชื่อไฟล์ (IMG_1323 → IMG_1327 → …) = ลำดับที่ถ่ายจริง
 *   กำหนดเอง   เรียงตามที่สั่ง ใช้ตอน "ลำดับเล่าเรื่อง ≠ ลำดับถ่าย"
 *
 * ใช้:
 *   bun order.ts <โปรเจกต์> --dry                       ดูลำดับปัจจุบัน + ลำดับใหม่
 *   bun order.ts <โปรเจกต์>                             เรียงตามเลขในชื่อไฟล์
 *   bun order.ts <โปรเจกต์> --desc                      เรียงย้อนกลับ
 *   bun order.ts <โปรเจกต์> --order "IMG_1327,IMG_1323" เรียงเองตามที่พิมพ์
 *      (คลิปที่ไม่ได้พิมพ์ในรายการ จะถูกต่อท้ายตามลำดับเดิม ไม่หาย)
 *
 * ⚠️ ปิด CapCut ก่อนรัน. สำรองไฟล์เดิมเป็น .PRE_ORDER_BAK
 * ⚠️ ซับที่ผูกกับลำดับเดิมจะเพี้ยน — เรียงเสร็จค่อยรัน cc.ts ใหม่
 */
import { readFileSync } from "node:fs";
import { loadDraft, saveDraft, requireCapCutClosed, videoTracks, textTracks, clipName, die, US } from "./lib/draft";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n: string) => argv.includes(`--${n}`);
const PROJ = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["dry", "desc"].includes(argv[i - 1].slice(2))));

if (!PROJ || has("help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
  process.exit(PROJ ? 0 : 1);
}

const DRY = has("dry");
const DESC = has("desc");
const wanted = flag("order", "").split(",").map((s) => s.trim()).filter(Boolean);

const draft = loadDraft(PROJ);
const vtracks = videoTracks(draft);
if (!vtracks.length) die("โปรเจกต์นี้ไม่มีคลิปวิดีโอบนไทม์ไลน์");

const segs = [...(vtracks[0].segments || [])];
if (segs.length < 2) die(`มีคลิปแค่ ${segs.length} คลิป ไม่ต้องเรียง`);

/** เลขลำดับในชื่อไฟล์ — เอาเฉพาะเลขที่ยืนโดดๆ ระหว่างขีด/จุด (IMG_1323.MOV → 1323)
 *  ชื่อแบบ joined_video_93b17167e34... ไม่นับ เพราะ "93b17..." ไม่ใช่เลขล้วน
 *  คืน null = ชื่อนี้บอกลำดับไม่ได้ */
const numOf = (nm: string): number | null => {
  const base = nm.replace(/\.[^.]+$/, "");
  const hits = [...base.matchAll(/(?:^|[_\-\s])(\d{2,})(?=$|[_\-\s])/g)];
  return hits.length ? parseInt(hits[hits.length - 1][1], 10) : null;
};

const before = segs.map((s) => clipName(draft, s));

let sorted: any[];
if (wanted.length) {
  // จัดตามที่สั่ง — จับคู่แบบ "ชื่อไฟล์มีคำนี้อยู่" เพื่อไม่ต้องพิมพ์นามสกุลไฟล์
  const rank = (s: any) => {
    const nm = clipName(draft, s);
    const i = wanted.findIndex((w) => nm.includes(w));
    return i >= 0 ? i : wanted.length + segs.indexOf(s);
  };
  const missed = wanted.filter((w) => !segs.some((s) => clipName(draft, s).includes(w)));
  if (missed.length) die(`ไม่เจอคลิปชื่อนี้ในโปรเจกต์: ${missed.join(", ")}\n   ชื่อที่มี: ${before.join(" · ")}`);
  sorted = [...segs].sort((a, b) => rank(a) - rank(b));
} else {
  // ชื่อไฟล์ที่บอกลำดับไม่ได้ = เดาไม่ได้ ต้องดังตรงนี้ ไม่ใช่เรียงมั่วแล้วให้ไปเจอเองบนไทม์ไลน์
  const noNum = before.filter((n) => numOf(n) === null);
  if (noNum.length) {
    die(`เรียงอัตโนมัติไม่ได้ — มี ${noNum.length} คลิปที่ชื่อไฟล์ไม่มีเลขลำดับ:
   ${noNum.join(" · ")}

   สั่งลำดับเองแทน:
   bun order.ts ${PROJ} --order "${before.slice(0, 3).join(",")},..."`);
  }
  sorted = [...segs].sort((a, b) => (numOf(clipName(draft, a)) ?? 0) - (numOf(clipName(draft, b)) ?? 0));
  if (DESC) sorted.reverse();
}

const after = sorted.map((s) => clipName(draft, s));
const changed = after.some((n, i) => n !== before[i]);

console.log(`\n🔀 ${PROJ}\n`);
console.log("   ลำดับเดิม → ลำดับใหม่");
for (let i = 0; i < after.length; i++) {
  const mark = after[i] === before[i] ? "  " : "→ ";
  console.log(`   ${mark}${String(i + 1).padStart(2)}. ${before[i] || "(ไม่มีชื่อ)"}${after[i] !== before[i] ? `   ⇒ ${after[i]}` : ""}`);
}

if (!changed) {
  console.log("\n✅ เรียงถูกอยู่แล้ว ไม่ต้องแก้อะไร\n");
  process.exit(0);
}

if (DRY) {
  console.log("\n👀 โหมด --dry: ยังไม่แตะโปรเจกต์ — เอา --dry ออกแล้วรันใหม่เพื่อเรียงจริง\n");
  process.exit(0);
}

await requireCapCutClosed();

// วางต่อกันแบบชิด ไม่มีช่องว่าง
let cursor = 0;
for (const s of sorted) {
  const dur = s.target_timerange?.duration || 0;
  s.target_timerange = { start: Math.round(cursor), duration: dur };
  cursor += dur;
}
vtracks[0].segments = sorted;

// ซับเดิมผูกกับลำดับเก่า = ไม่ตรงแล้ว ลบทิ้งแล้วให้ไปยิงใหม่
let dropped = 0;
for (const t of textTracks(draft)) dropped += (t.segments || []).length;
draft.tracks = (draft.tracks || []).filter((t: any) => t.type !== "text");

const res = await saveDraft(PROJ, draft, "PRE_ORDER_BAK");
console.log(`\n✅ เรียงใหม่ ${sorted.length} คลิป · ยาวรวม ${(cursor / US).toFixed(1)} วิ`);
console.log(`   ลบซับเดิม ${dropped} กล่อง (ผูกกับลำดับเก่า ใช้ต่อไม่ได้) — อยู่ในไฟล์สำรองแล้ว`);
console.log(`   sync Timelines ${res.synced} ไฟล์ · สำรอง .PRE_ORDER_BAK`);
console.log(`\n👉 ต่อด้วย: เปิด CapCut กด Auto captions ใหม่ แล้วรัน  bun cc.ts ${PROJ}\n`);
