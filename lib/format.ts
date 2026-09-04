/**
 * format.ts — ค่าที่ปรับได้ทั้งหมด อ่านจาก ~/.sararif-cc/format.json
 *
 * ค่าเริ่มต้นคือฟอร์แมตที่ผมใช้กับช่องตัวเอง (เน้น hook + ให้คนดูจนจบ)
 * แต่มันไม่ใช่ของตายตัว — ใครอยากได้คลิปยาวกว่านี้ ซับใหญ่กว่านี้ ก็แก้ไฟล์เอา
 *
 * ลำดับความสำคัญ: ธงที่พิมพ์ในคำสั่ง > ไฟล์ format.json > ค่าเริ่มต้นในนี้
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USER_DIR = join(homedir(), ".sararif-cc");
export const FORMAT_FILE = join(USER_DIR, "format.json");

/** สไตล์ซับสำเร็จรูป — แกะจาก framework ที่ผมใช้จริงกับช่องตัวเอง
 *  เลือกด้วย --style หรือใส่ "style" ในไฟล์ format.json */
export const STYLES: Record<string, {
  label: string; desc: string; mode: "text" | "karaoke" | "genz";
  maxchars: number; size: number;
}> = {
  text: {
    label: "ข้อความ",
    desc: "วลีสั้นขาว อ่านง่าย — ใช้ได้กับทุกคลิป ถ้าไม่รู้จะเลือกอะไรใช้อันนี้",
    mode: "text", maxchars: 16, size: 15,
  },
  karaoke: {
    label: "คาราโอเกะ",
    desc: "ขึ้นทีละคำตามจังหวะพูด ตาคนดูวิ่งตลอดแม้ภาพจะค้าง — คลิปสั้นสายความรู้/สอน",
    mode: "karaoke", maxchars: 16, size: 18,
  },
  genz: {
    label: "GenZ",
    desc: "ซับใหญ่เต็มจอ วลีไหนมีคำเด็ดเหลืองทั้งวลี — คลิปไวรัล/ทริป/ไลฟ์สไตล์",
    mode: "genz", maxchars: 11, size: 30,
  },
};

export type Format = {
  style: keyof typeof STYLES | string;
  clipSeconds: { min: number; max: number };
  silence: { head: number; tail: number; gap: number; min: number };
  subtitle: { maxchars: number; y: number; size: number };
  hook: { y: number; size: number; seconds: number };
  highlightColor: string;
  checks: { introSeconds: number; repeatSimilarity: number };
};

export const DEFAULTS: Format = {
  // สไตล์ซับ: text · karaoke · genz  (ดูรายละเอียดด้วย bun setup.ts --show)
  style: "text",
  // ความยาวที่ตั้งเป้า — คลิปสั้นที่ "ดูจบ" ชนะคลิปยาวที่คนเลื่อนผ่านกลางทาง
  clipSeconds: { min: 25, max: 30 },
  // ตัดช่วงเงียบ: เผื่อหัว/ท้ายกี่วินาที · ช่องเงียบสั้นกว่า gap ไม่ตัด · ท่อนสั้นกว่า min ทิ้ง
  silence: { head: 0.2, tail: 0.4, gap: 0.6, min: 0.3 },
  // ซับ: ตัวอักษรสูงสุดต่อบรรทัด · ตำแหน่งแนวตั้ง (-1 = ล่างสุด) · ขนาด
  subtitle: { maxchars: 16, y: -0.8, size: 15 },
  // hook: ตำแหน่งแนวตั้ง (1 = บนสุด) · ขนาด · โชว์กี่วินาที
  hook: { y: 0.55, size: 22, seconds: 3 },
  // สีของคำที่เน้น (ทั้งในซับและใน hook)
  highlightColor: "#FFD400",
  // ค่าที่ตัวตรวจใช้: ช่วงต้นคลิปกี่วินาทีที่ถือว่าเป็น "แนะนำตัว" · ความคล้ายที่ถือว่าพูดซ้ำ
  checks: { introSeconds: 5, repeatSimilarity: 0.8 },
};

/** อ่านไฟล์ตั้งค่า — ยอมให้มีบรรทัดหมายเหตุขึ้นต้นด้วย // เพราะคนแก้ไม่ใช่โปรแกรมเมอร์
 *
 * ลำดับที่ทับกัน (บนสุดชนะ):
 *   1. --style ที่พิมพ์ในคำสั่ง
 *   2. ค่าที่ผู้ใช้เขียนไว้เองในไฟล์ (เช่นตั้ง subtitle.size เอง)
 *   3. สไตล์ที่ตั้งไว้ในไฟล์ ("style": "genz")
 *   4. ค่าเริ่มต้น
 */
export function loadFormat(styleFlag?: string | null): Format {
  if (!existsSync(FORMAT_FILE)) {
    return styleFlag ? applyStyle(DEFAULTS, styleFlag) : DEFAULTS;
  }
  const raw = readFileSync(FORMAT_FILE, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  let user: any;
  try {
    user = JSON.parse(raw);
  } catch (e) {
    console.error(`\n⚠️ อ่าน ${FORMAT_FILE} ไม่ได้ (ไฟล์ผิดรูปแบบ) — ใช้ค่าเริ่มต้นแทน`);
    console.error(`   ${(e as Error).message}`);
    console.error(`   ลบไฟล์ทิ้งแล้วสั่ง  bun setup.ts  เพื่อสร้างใหม่ได้\n`);
    return DEFAULTS;
  }
  // สไตล์วางเป็นฐานก่อน แล้วค่อยเอาค่าที่ผู้ใช้เขียนเองทับ (ผู้ใช้ชนะสไตล์ในไฟล์)
  const base = applyStyle(DEFAULTS, (user.style as string) || DEFAULTS.style);

  // รวมทีละชั้น — ใส่มาแค่บางค่าก็ได้ ที่ไม่ใส่ใช้ค่าเริ่มต้น
  const merged: any = { ...base };
  for (const [k, v] of Object.entries(user)) {
    merged[k] = v && typeof v === "object" && !Array.isArray(v)
      ? { ...(base as any)[k], ...v }
      : v;
  }
  // --style ที่พิมพ์ในคำสั่ง = ผู้ใช้สั่งตรงๆ ชนะทุกอย่างในไฟล์
  return styleFlag ? applyStyle(merged as Format, styleFlag) : (merged as Format);
}

/** เอาสไตล์มาทับค่าซับ — ใช้เมื่อผู้ใช้ระบุ --style หรือตั้ง "style" ไว้ในไฟล์
 *  ผู้ใช้ที่ตั้ง subtitle.size เองไว้แล้ว ยังชนะสไตล์ได้ผ่านธงในคำสั่ง */
export function applyStyle(f: Format, styleName?: string | null): Format {
  const name = (styleName || f.style || "text") as string;
  const s = STYLES[name];
  if (!s) {
    console.error(`\n⚠️ ไม่รู้จักสไตล์ "${name}" — มีให้เลือก: ${Object.keys(STYLES).join(" · ")}`);
    console.error(`   ใช้สไตล์ text แทน\n`);
    return { ...f, style: "text" };
  }
  return { ...f, style: name, subtitle: { ...f.subtitle, maxchars: s.maxchars, size: s.size } };
}

/** ค่าที่จะใช้จริง: ธงในคำสั่งมาก่อน แล้วค่อยไฟล์ตั้งค่า */
export const pick = (flagValue: string | null | undefined, fromFormat: number) =>
  flagValue === null || flagValue === undefined ? fromFormat : parseFloat(flagValue);
