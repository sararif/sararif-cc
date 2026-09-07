/**
 * draft.ts — อ่าน/เขียนไฟล์โปรเจกต์ CapCut ให้ปลอดภัย ใช้ร่วมกันทุกสคริปต์
 *
 * 🚨 กับดักที่ทำให้งานหายเงียบๆ: CapCut เก็บไฟล์โปรเจกต์ไว้ 2 ที่
 *     <proj>/draft_info.json                          ← สคริปต์เขียนที่นี่
 *     <proj>/Timelines/<id>/draft_info.json           ← CapCut อ่านจากที่นี่
 *   เขียนแค่ไฟล์บนสุด = เปิด CapCut มาเห็นของเก่า แล้วมันเซฟทับ งานที่เพิ่งใส่หายหมด
 *   โดยไม่มี error อะไรเลย — ต้องเขียนให้ครบทั้ง 2 ที่เสมอ
 *
 * บน Windows ไฟล์ชื่อ draft_content.json แทน — lib/platform.ts จัดการให้แล้ว
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { Glob } from "bun";
import { DRAFT_ROOT, DRAFT_NAMES, draftFileName, capcutState, askCapCutToQuit, QUIT_HINT } from "./platform";

export { DRAFT_ROOT, QUIT_HINT };
export const US = 1_000_000;

export const draftPath = (proj: string) => {
  const dir = join(DRAFT_ROOT, proj);
  return join(dir, draftFileName(dir));
};

export function die(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

/** ปิด CapCut ให้ก่อนแตะไฟล์ — ไม่ยอมเขียนถ้าปิดไม่ได้หรือเช็คไม่ได้ (fail-closed) */
export async function requireCapCutClosed() {
  let state = await capcutState();
  if (state === "stopped") return;
  if (state === "running") {
    console.log("🚪 CapCut เปิดอยู่ — ปิดให้ก่อน (ไม่งั้นงานจะถูกเขียนทับหาย)");
    await askCapCutToQuit();
    for (let i = 0; i < 20 && (await capcutState()) === "running"; i++) await Bun.sleep(500);
    state = await capcutState();
  }
  if (state !== "stopped") {
    die(
      state === "unknown"
        ? `เช็คไม่ได้ว่า CapCut เปิดอยู่ไหม — ไม่ยอมเขียนไฟล์ (กันงานหาย)\n   ${QUIT_HINT} แล้วรันใหม่`
        : `ปิด CapCut ไม่สำเร็จ — ${QUIT_HINT} แล้วรันใหม่`,
    );
  }
}

export function loadDraft(proj: string): any {
  const p = draftPath(proj);
  if (!existsSync(p)) {
    die(`ไม่พบโปรเจกต์ "${proj}"\n   เช็คชื่อให้ตรงกับที่ตั้งไว้ใน CapCut`);
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

/** เขียนกลับ + สำรองไฟล์เดิม + กระจายไปสำเนาใน Timelines/ ให้ครบ */
export async function saveDraft(proj: string, draft: any, bakSuffix: string) {
  const p = draftPath(proj);
  writeFileSync(`${p}.${bakSuffix}`, readFileSync(p, "utf8"));
  const body = JSON.stringify(draft);
  writeFileSync(p, body);
  let n = 0;
  for (const name of DRAFT_NAMES) {
    for await (const rel of new Glob(`Timelines/*/${name}`).scan(dirname(p))) {
      writeFileSync(join(dirname(p), rel), body);
      n++;
    }
  }
  return { bak: `${bakSuffix}`, synced: n };
}

export const videoTracks = (d: any) => (d.tracks || []).filter((t: any) => t.type === "video");
export const textTracks = (d: any) => (d.tracks || []).filter((t: any) => t.type === "text");

/** ชื่อไฟล์ของ segment (ใช้ตอนเรียงลำดับ/แสดงผล) */
export function clipName(draft: any, seg: any): string {
  const m = (draft.materials?.videos || []).find((v: any) => v.id === seg.material_id);
  return (m?.material_name || m?.path?.split(/[\\/]/).pop() || "").toString();
}
