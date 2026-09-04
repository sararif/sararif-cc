#!/usr/bin/env bun
/**
 * hook.ts — ใส่ข้อความ hook ตัวใหญ่ไว้ช่วงต้นคลิป (ตัวที่ทำให้คนหยุดนิ้ว)
 *
 * ฟอนต์ธรรมดาที่ CapCut มีอยู่แล้ว ไม่ใช้ text template — จัดตำแหน่งเองใน CapCut ทีหลังได้
 * อยากให้คำไหนเป็นสีเหลือง ใส่ [วงเล็บเหลี่ยม] ครอบคำนั้น
 *
 * ใช้:
 *   bun hook.ts <โปรเจกต์> --l1 "ตัดคลิป 1 ชั่วโมง" --l2 "เหลือ [3 นาที]"
 *   bun hook.ts <โปรเจกต์> --l1 ".." --start 0 --dur 3 --y 0.55 --size 22
 *
 * ตัวเลือก:
 *   --l1 --l2 --l3     ข้อความบรรทัดที่ 1-3
 *   --start 0          วินาทีที่เริ่มโชว์
 *   --dur 3            โชว์นานกี่วินาที
 *   --y 0.55           ตำแหน่งแนวตั้ง (1 = บนสุด, -1 = ล่างสุด)
 *   --size 22          ขนาดตัวอักษร
 *   --color "#FFD400"  สีของคำใน [วงเล็บเหลี่ยม]
 *
 * ⚠️ ปิด CapCut ก่อนรัน. สำรองไฟล์เดิมเป็น .PRE_HOOK_BAK
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireCapCutClosed, draftPath, die } from "./lib/draft";
import { Glob } from "bun";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (n: string) => argv.includes(`--${n}`);
const PROJ = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

if (!PROJ || !argv.includes("--l1") || has("help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
  process.exit(PROJ && argv.includes("--l1") ? 0 : 1);
}

if (!existsSync(draftPath(PROJ))) die(`ไม่พบโปรเจกต์ "${PROJ}" — เช็คชื่อให้ตรงกับที่ตั้งไว้ใน CapCut`);

await requireCapCutClosed();

const py = join(HERE, "scripts", "capcut_hook.py");
const proc = Bun.spawnSync(["python3", py, PROJ, ...argv.filter((a) => a !== PROJ)], {
  stdout: "inherit", stderr: "inherit",
});
if (proc.exitCode !== 0) die("ใส่ hook ไม่สำเร็จ");

// CapCut อ่านจากสำเนาใน Timelines/ — ไม่ก๊อปไปด้วย งานจะหายตอนเปิดโปรแกรม
const dir = dirname(draftPath(PROJ));
const body = readFileSync(draftPath(PROJ), "utf8");
let n = 0;
for await (const rel of new Glob("Timelines/*/draft_info.json").scan(dir)) {
  await Bun.write(join(dir, rel), body);
  n++;
}
console.log(`   sync Timelines ${n} ไฟล์`);
console.log(`\n👉 เปิด CapCut ดูผลได้เลย — อยากขยับตำแหน่ง/ขนาด ลากเองในโปรแกรมได้ ไม่โดนทับ\n`);
