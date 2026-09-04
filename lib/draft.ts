/**
 * draft.ts — อ่าน/เขียนไฟล์โปรเจกต์ CapCut ให้ปลอดภัย ใช้ร่วมกันทุกสคริปต์
 *
 * 🚨 กับดักที่ทำให้งานหายเงียบๆ: CapCut เก็บไฟล์โปรเจกต์ไว้ 2 ที่
 *     <proj>/draft_info.json                          ← สคริปต์เขียนที่นี่
 *     <proj>/Timelines/<id>/draft_info.json           ← CapCut อ่านจากที่นี่
 *   เขียนแค่ไฟล์บนสุด = เปิด CapCut มาเห็นของเก่า แล้วมันเซฟทับ งานที่เพิ่งใส่หายหมด
 *   โดยไม่มี error อะไรเลย — ต้องเขียนให้ครบทั้ง 2 ที่เสมอ
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { Glob } from "bun";

export const DRAFT_ROOT = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft");
export const US = 1_000_000;

export const draftPath = (proj: string) => join(DRAFT_ROOT, proj, "draft_info.json");

export function die(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

/** ปิด CapCut ให้ก่อนแตะไฟล์ — ไม่ยอมเขียนถ้าปิดไม่ได้ (fail-closed) */
export async function requireCapCutClosed() {
  const running = async () =>
    (await Bun.$`pgrep -x CapCut`.quiet().nothrow()).exitCode === 0;
  if (!(await running())) return;
  console.log("🚪 CapCut เปิดอยู่ — ปิดให้ก่อน (ไม่งั้นงานจะถูกเขียนทับหาย)");
  await Bun.$`osascript -e ${'tell application "CapCut" to quit'}`.quiet().nothrow();
  for (let i = 0; i < 20 && (await running()); i++) await Bun.sleep(500);
  if (await running()) die("ปิด CapCut ไม่สำเร็จ — ปิดเองแล้วรันใหม่");
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
  for await (const rel of new Glob("Timelines/*/draft_info.json").scan(dirname(p))) {
    writeFileSync(join(dirname(p), rel), body);
    n++;
  }
  return { bak: `${bakSuffix}`, synced: n };
}

export const videoTracks = (d: any) => (d.tracks || []).filter((t: any) => t.type === "video");
export const textTracks = (d: any) => (d.tracks || []).filter((t: any) => t.type === "text");

/** ชื่อไฟล์ของ segment (ใช้ตอนเรียงลำดับ/แสดงผล) */
export function clipName(draft: any, seg: any): string {
  const m = (draft.materials?.videos || []).find((v: any) => v.id === seg.material_id);
  return (m?.material_name || m?.path?.split("/").pop() || "").toString();
}
