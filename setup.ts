#!/usr/bin/env bun
/**
 * setup.ts — รันครั้งเดียวหลังโหลดโปรเจกต์มา
 *
 * สร้างไฟล์ตั้งค่าของคุณเองใน ~/.sararif-cc/ แล้วบอกว่าสั่งอะไรได้บ้าง
 * ไม่รันก็ใช้งานได้ (มันใช้ค่าเริ่มต้น) แต่รันแล้วจะรู้ว่าอะไรปรับได้บ้าง
 *
 * ใช้:  bun setup.ts          สร้างไฟล์ที่ยังไม่มี แล้วแสดงคู่มือ
 *       bun setup.ts --show   แสดงคู่มืออย่างเดียว ไม่สร้างอะไร
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { USER_DIR, FORMAT_FILE, DEFAULTS, loadFormat } from "./lib/format";

const SHOW_ONLY = process.argv.includes("--show");

const FORMAT_TEMPLATE = `// ── ฟอร์แมตของคุณ ──────────────────────────────────────────────
// ค่าข้างล่างคือฟอร์แมตที่ผมใช้กับช่องตัวเอง (เน้น hook + ให้คนดูจนจบ)
// ไม่ใช่ของตายตัว — แก้ตัวเลขได้เลย ลบบรรทัดไหนออกก็ได้ ที่ลบจะใช้ค่าเริ่มต้น
// บรรทัดที่ขึ้นต้นด้วย // เป็นหมายเหตุ ระบบข้ามให้
{
  // ความยาวคลิปที่ตั้งเป้า (วินาที) — ตัวตรวจจะเตือนถ้าเกิน
  // ผมใช้ 25-30 เพราะคลิปช่องผมที่ยาวเกิน 60 วิ ยังไม่เคยทำวิวเกินค่าเฉลี่ย
  // ถ้าคลิปคุณเป็นสายสอน/รีวิวยาว ก็ตั้ง 60 หรือ 90 ได้
  "clipSeconds": { "min": ${DEFAULTS.clipSeconds.min}, "max": ${DEFAULTS.clipSeconds.max} },

  // การตัดช่วงเงียบ (วินาที)
  //   head/tail = เผื่อไว้ก่อนเริ่มพูด/หลังพูดจบ  · gap = ช่องเงียบสั้นกว่านี้ไม่ตัด
  //   min       = ท่อนที่สั้นกว่านี้ทิ้งไป
  //   อยากได้คลิปกระชับมาก ลด gap ลง · อยากได้จังหวะหายใจ เพิ่ม head/tail
  "silence": { "head": ${DEFAULTS.silence.head}, "tail": ${DEFAULTS.silence.tail}, "gap": ${DEFAULTS.silence.gap}, "min": ${DEFAULTS.silence.min} },

  // ซับ — maxchars = ตัวอักษรสูงสุดต่อบรรทัด (ยิ่งน้อย ยิ่งซอยถี่)
  //        y = ตำแหน่งแนวตั้ง (-1 ล่างสุด · 0 กลางจอ) · size = ขนาดตัวอักษร
  //        อยากได้ซับใหญ่แบบคลิปไวรัล ลอง size 30 แล้วลด maxchars เหลือ 11
  "subtitle": { "maxchars": ${DEFAULTS.subtitle.maxchars}, "y": ${DEFAULTS.subtitle.y}, "size": ${DEFAULTS.subtitle.size} },

  // hook — y = ตำแหน่งแนวตั้ง (1 บนสุด) · size = ขนาด · seconds = โชว์กี่วินาที
  "hook": { "y": ${DEFAULTS.hook.y}, "size": ${DEFAULTS.hook.size}, "seconds": ${DEFAULTS.hook.seconds} },

  // สีของคำที่เน้น (ใส่ --highlight ในคำสั่ง หรือ [วงเล็บ] ใน hook)
  "highlightColor": "${DEFAULTS.highlightColor}",

  // ค่าที่ตัวตรวจใช้
  //   introSeconds     = ช่วงต้นคลิปกี่วินาทีที่ถือว่าเป็น "แนะนำตัว" (ควรตัดทิ้ง)
  //   repeatSimilarity = ข้อความคล้ายกันเกินนี้ ถือว่าพูดเรื่องเดิมซ้ำ (0-1)
  "checks": { "introSeconds": ${DEFAULTS.checks.introSeconds}, "repeatSimilarity": ${DEFAULTS.checks.repeatSimilarity} }
}
`;

const WORDS_TEMPLATE = `// ไม่ต้องใส่ // ในไฟล์นี้ — ใช้ # แทน
# คำที่ห้ามตัดกลาง — 1 บรรทัด 1 คำ
# ใส่ชื่อร้าน ชื่อคน ชื่อสินค้า ชื่อสถานที่ ที่ตัวตัดคำไทยไม่รู้จัก
# เจอซับตัดคำไหนขาดกลาง เอาคำนั้นมาใส่ที่นี่ แล้วรันใหม่
#
# ตัวอย่าง:
# ทางสายบุรี
# โดโลไมท์
`.replace("// ไม่ต้องใส่ // ในไฟล์นี้ — ใช้ # แทน\n", "");

const FIX_TEMPLATE = `# คำที่ถอดเสียงมาผิดบ่อย — 1 บรรทัด:  คำที่ได้ยินผิด = คำที่ถูก
# ชื่อแบรนด์/ชื่อร้านของคุณ ระบบถอดเสียงมักได้ยินเพี้ยน ใส่ทุกแบบที่เคยเจอ
#
# ตัวอย่าง:
# บางกำ = บางกล่ำ
# หะลาล = ฮาลาล
`;

if (!SHOW_ONLY) {
  mkdirSync(USER_DIR, { recursive: true });
  const files: [string, string][] = [
    [FORMAT_FILE, FORMAT_TEMPLATE],
    [join(USER_DIR, "words.txt"), WORDS_TEMPLATE],
    [join(USER_DIR, "fix.txt"), FIX_TEMPLATE],
  ];
  console.log(`\n📁 ไฟล์ตั้งค่าของคุณอยู่ที่  ${USER_DIR}\n`);
  for (const [path, body] of files) {
    const name = path.split("/").pop();
    if (existsSync(path)) {
      console.log(`   มีอยู่แล้ว ไม่ทับให้  ${name}`);
    } else {
      writeFileSync(path, body, "utf8");
      console.log(`   สร้างให้แล้ว        ${name}`);
    }
  }
}

const f = loadFormat();
console.log(`
════════════════════════════════════════════════════════
 ทุกอย่างปรับได้ — ไม่มีอะไรตายตัว
════════════════════════════════════════════════════════

ตอนนี้ตั้งไว้แบบนี้:

   ความยาวคลิปที่ตั้งเป้า   ${f.clipSeconds.min}-${f.clipSeconds.max} วินาที
   ซับ                      ${f.subtitle.maxchars} ตัวอักษร/บรรทัด · ขนาด ${f.subtitle.size}
   hook                     ขนาด ${f.hook.size} · โชว์ ${f.hook.seconds} วินาที
   สีคำที่เน้น              ${f.highlightColor}
   ช่องเงียบที่ถือว่าต้องตัด  เกิน ${f.silence.gap} วินาที

ปรับได้ 2 ทาง:

 1) พิมพ์ในคำสั่งเลย (ใช้ครั้งเดียว)
      bun go.ts myproj --maxchars 11 --size 30
      bun cut.ts myproj --gap 1.0

 2) แก้ไฟล์ ${FORMAT_FILE.replace(process.env.HOME || "", "~")}  (ใช้ตลอด)
      เปิดด้วย TextEdit หรือโปรแกรมแก้ข้อความอะไรก็ได้
      ในไฟล์มีหมายเหตุบอกไว้ทุกบรรทัดว่าค่านั้นทำอะไร

ตัวอย่างที่คนมักอยากเปลี่ยน:

   คลิปสายสอน/รีวิว ยาวได้      "clipSeconds": { "min": 45, "max": 90 }
   ซับใหญ่แบบคลิปไวรัล          "subtitle": { "maxchars": 11, "size": 30 }
   ตัดกระชับกว่านี้              "silence": { "gap": 0.35 }
   เปลี่ยนสีคำเน้นเป็นเขียว      "highlightColor": "#00E676"

สอนคำใหม่ให้มัน (ยิ่งใช้ยิ่งแม่น):

   ~/.sararif-cc/words.txt   ชื่อร้าน/ชื่อคน ที่ไม่อยากให้ซับตัดขาดกลาง
   ~/.sararif-cc/fix.txt     คำที่ถอดเสียงมาผิดบ่อย

════════════════════════════════════════════════════════
 เริ่มใช้เลย
════════════════════════════════════════════════════════

  1. เปิด CapCut ใส่คลิปลงไทม์ไลน์ → Text → Auto captions → ภาษาไทย
  2. ปิด CapCut
  3. bun go.ts <ชื่อโปรเจกต์> --highlight "คำที่อยากเน้น"
  4. เปิด CapCut ดูผล

  เช็คว่าเครื่องพร้อมไหม:  bun doctor.ts
  ดูคู่มือนี้อีกครั้ง:      bun setup.ts --show
`);
