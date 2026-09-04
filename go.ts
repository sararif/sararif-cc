#!/usr/bin/env bun
/**
 * go.ts — คำสั่งเดียวรันครบ: ตัดช่วงเงียบ → ใส่ซับ → ใส่ hook
 *
 * ใช้แทนการพิมพ์ cut.ts / cc.ts / hook.ts ทีละตัว
 * ปิด CapCut รอบเดียว รันทีเดียว เปิดกลับมาดูผลได้เลย
 *
 * ใช้:
 *   bun go.ts <โปรเจกต์>
 *   bun go.ts <โปรเจกต์> --highlight "ฟรี,ลดน้ำหนัก"
 *   bun go.ts <โปรเจกต์> --highlight "ฟรี" --l1 "ตัดคลิป 1 ชั่วโมง" --l2 "เหลือ [3 นาที]"
 *   bun go.ts <โปรเจกต์> --style genz      เลือกสไตล์ซับ (text · karaoke · genz)
 *   bun go.ts <โปรเจกต์> --no-cut          ไม่ต้องตัดช่วงเงียบ เอาแค่ซับ
 *   bun go.ts <โปรเจกต์> --dry             ดูว่าจะตัดอะไรออก แล้วหยุด
 *
 * ก่อนรัน — ใน CapCut ต้องทำ 2 อย่างนี้ก่อน:
 *   1. ใส่คลิปลงไทม์ไลน์ (เรียงลำดับให้ถูกด้วย bun order.ts ถ้าจำเป็น)
 *   2. Text → Auto captions → ภาษาไทย → รอถอดเสร็จ → ปิด CapCut
 *
 * ตัวเลือกที่ส่งต่อให้แต่ละขั้น:
 *   ตัดช่วงเงียบ   --head --tail --gap --min
 *   ซับ            --style --highlight --hl-color --maxchars --y --size
 *   hook           --l1 --l2 --l3 --hook-start --hook-dur --hook-y --hook-size
 *   ทั้งคู่        --track   (แทร็กซับที่ใช้เป็นตัวจับคำพูด)
 *
 * อยากปรับละเอียดกว่านี้ ให้รันทีละคำสั่งแทน (cut.ts / cc.ts / hook.ts)
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { draftPath, requireCapCutClosed, die } from "./lib/draft";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (n: string) => argv.includes(`--${n}`);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : null;
};
const PROJ = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["dry", "no-cut"].includes(argv[i - 1].slice(2))));

if (!PROJ || has("help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
  process.exit(PROJ ? 0 : 1);
}
if (!existsSync(draftPath(PROJ))) die(`ไม่พบโปรเจกต์ "${PROJ}" — เช็คชื่อให้ตรงกับที่ตั้งไว้ใน CapCut`);

/** ส่งต่อเฉพาะธงที่ขั้นนั้นรู้จัก — ธงที่ไม่รู้จักทำให้สคริปต์งง */
const pass = (names: string[]) =>
  names.flatMap((n) => {
    const v = flag(n);
    return v === null ? [] : [`--${n}`, v];
  });

// ปิด CapCut ครั้งเดียวตรงนี้ ขั้นย่อยจะเช็คซ้ำแล้วผ่านทันที
await requireCapCutClosed();

const step = async (label: string, script: string, args: string[]) => {
  console.log(`\n${"─".repeat(52)}\n▶ ${label}\n${"─".repeat(52)}`);
  const r = Bun.spawnSync(["bun", join(HERE, script), PROJ, ...args], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, SARARIF_CC_CHAIN: "1" },   // ปิดข้อความ "ต่อด้วย..." ของแต่ละขั้น
  });
  if (r.exitCode !== 0) die(`หยุดที่ขั้น "${label}" — แก้ตามที่บอกข้างบนแล้วรันใหม่`);
};

const DRY = has("dry");
const NOCUT = has("no-cut");
const trackArgs = pass(["track"]);

if (!NOCUT) {
  await step("ตัดช่วงเงียบ", "cut.ts", [
    ...pass(["head", "tail", "gap", "min"]), ...trackArgs, ...(DRY ? ["--dry"] : []),
  ]);
  if (DRY) {
    console.log("\n👀 --dry แสดงแค่ขั้นตัดเท่านั้น (ขั้นซับต้องตัดจริงก่อนถึงจะดูได้)");
    console.log("   พอใจแล้วเอา --dry ออก แล้วรันใหม่\n");
    process.exit(0);
  }
}

await step("ใส่ซับ", "cc.ts", [
  ...pass(["highlight", "hl-color", "maxchars", "y", "size", "style"]), ...trackArgs,
]);

const hookLines = ["l1", "l2", "l3"].filter((n) => flag(n) !== null);
if (hookLines.length) {
  // hook ใช้ y/size คนละค่ากับซับ (อยู่บนจอ ตัวใหญ่กว่า) จึงมีธงของตัวเอง
  const rename = (from: string, to: string) => {
    const v = flag(from);
    return v === null ? [] : [`--${to}`, v];
  };
  await step("ใส่ hook", "hook.ts", [
    ...pass(["l1", "l2", "l3", "color"]),
    ...rename("hook-start", "start"), ...rename("hook-dur", "dur"),
    ...rename("hook-y", "y"), ...rename("hook-size", "size"),
  ]);
}

console.log(`\n${"═".repeat(52)}`);
console.log(`✅ เสร็จครบทุกขั้น — เปิด CapCut แล้วเปิดโปรเจกต์ "${PROJ}" ดูได้เลย`);
console.log(`   ถ้าซับไม่ขึ้น: ปิด CapCut ให้สนิทก่อนแล้วเปิดใหม่ (มันแคช draft ไว้)`);
console.log(`   ไฟล์เดิมสำรองไว้ครบทุกขั้น (.PRE_CUT_BAK / .PRE_CC_BAK / .PRE_HOOK_BAK)`);
console.log(`${"═".repeat(52)}\n`);
