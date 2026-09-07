/**
 * platform.ts — ความต่างระหว่าง Mac กับ Windows รวมไว้ที่เดียว
 *
 * ของที่ต่างกันจริง (ยืนยันจากเครื่องจริง + เครื่องมือ open-source ที่อ่าน draft CapCut):
 *   1. ที่เก็บโปรเจกต์   Mac: ~/Movies/CapCut/...   Windows: %LOCALAPPDATA%\CapCut\...
 *   2. ชื่อไฟล์ draft    Mac: draft_info.json       Windows: draft_content.json
 *   3. วิธีเช็ค/ปิดโปรแกรม  Mac: pgrep + osascript   Windows: tasklist + taskkill
 *   4. คำสั่ง Python     Mac: python3               Windows: python หรือ py -3
 *
 * เครื่องไหน path ไม่ตรงมาตรฐาน (เช่นลง CapCut จาก Microsoft Store):
 *   ตั้ง SARARIF_CC_DRAFT_ROOT ชี้ไปโฟลเดอร์ com.lveditor.draft ได้เลย ไม่ต้องแก้โค้ด
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const IS_WIN = process.platform === "win32";

// ── ที่เก็บโปรเจกต์ ────────────────────────────────────────────────────
// แยกเป็นฟังก์ชันรับค่า platform/env เพื่อให้ทดสอบ path ฝั่ง Windows ได้จากเครื่อง Mac
export function buildDraftRoot(plat: string, env: Record<string, string | undefined>, home: string): string {
  if (env.SARARIF_CC_DRAFT_ROOT) return env.SARARIF_CC_DRAFT_ROOT;
  if (plat === "win32") {
    const base = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return join(base, "CapCut", "User Data", "Projects", "com.lveditor.draft");
  }
  return join(home, "Movies/CapCut/User Data/Projects/com.lveditor.draft");
}

export const DRAFT_ROOT = buildDraftRoot(process.platform, process.env, homedir());

// ── ชื่อไฟล์ draft ────────────────────────────────────────────────────
// Windows ใช้ draft_content.json (Mac ใช้ draft_info.json) — เผื่อเวอร์ชันแปลกๆ
// ให้ดูของจริงในโฟลเดอร์ก่อน ตรงไหนมีไฟล์ใช้ตัวนั้น
export const DRAFT_NAMES = ["draft_info.json", "draft_content.json"] as const;

export function draftFileName(projDir: string, plat: string = process.platform): string {
  const prefer = plat === "win32" ? "draft_content.json" : "draft_info.json";
  const other = prefer === "draft_content.json" ? "draft_info.json" : "draft_content.json";
  if (existsSync(join(projDir, prefer))) return prefer;
  if (existsSync(join(projDir, other))) return other;
  return prefer; // ยังไม่มีไฟล์เลย — คืนชื่อตาม OS ไว้ใช้ในข้อความ error
}

// ── รายชื่อโปรเจกต์ (ใช้ตอน "ไม่พบโปรเจกต์" — ห้ามใช้ `ls` เพราะ Windows ไม่มี) ──
export function listProjects(): string[] {
  if (!existsSync(DRAFT_ROOT)) return [];
  try {
    return readdirSync(DRAFT_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ── เช็ค/ปิด CapCut ───────────────────────────────────────────────────
const sh = async (cmd: string[]) => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    const err = await new Response(p.stderr).text();
    return { code: await p.exited, out, err };
  } catch {
    return { code: 127, out: "", err: "spawn failed" };
  }
};

/** "running" | "stopped" | "unknown" — unknown = เช็คไม่ได้ ให้ fail-closed ฝั่งคนเรียก */
export async function capcutState(): Promise<"running" | "stopped" | "unknown"> {
  if (IS_WIN) {
    const r = await sh(["tasklist", "/NH", "/FI", "IMAGENAME eq CapCut.exe"]);
    if (r.code !== 0) return "unknown";
    return /CapCut\.exe/i.test(r.out) ? "running" : "stopped";
  }
  const pg = await sh(["pgrep", "-x", "CapCut"]);
  if (pg.code === 0 && pg.out.trim()) return "running";
  if (/cannot get process list|operation not permitted/i.test(pg.err)) return "unknown";
  const ps = await sh(["ps", "-Ao", "command"]);
  if (ps.code !== 0) return "unknown";
  return /MacOS\/CapCut(\s|$)/m.test(ps.out) ? "running" : "stopped";
}

/** ขอปิดแบบสุภาพ (ให้ CapCut ได้เซฟของมันเอง) — ไม่ฆ่าโปรเซสแบบบังคับเด็ดขาด */
export async function askCapCutToQuit(): Promise<void> {
  if (IS_WIN) {
    // taskkill แบบไม่มี /F = ส่งสัญญาณปิดหน้าต่างปกติ (เทียบเท่ากดปุ่ม X)
    await sh(["taskkill", "/IM", "CapCut.exe"]);
    return;
  }
  await sh(["osascript", "-e", 'tell application "CapCut" to quit']);
}

/** ข้อความ "ปิดโปรแกรมให้สนิท" ตาม OS — Windows ไม่มี Cmd+Q */
export const QUIT_HINT = IS_WIN
  ? "ปิดหน้าต่าง CapCut ให้หมดทุกบาน (กด X) แล้วเช็คว่าไม่ค้างใน Task Manager"
  : "ปิด CapCut ให้สนิทด้วย Cmd+Q (ไม่ใช่แค่ปิดหน้าต่าง)";

// ── คำสั่ง Python ─────────────────────────────────────────────────────
// Windows: "python3" มักไม่มี · "python" อาจเป็นตัวปลอมของ Microsoft Store
// (เรียกแล้วเปิดหน้า Store แทน) จึงต้องเช็คว่าตอบ "Python 3" จริงก่อนเชื่อ
let pyCache: string[] | null = null;
export function pythonCmd(): string[] {
  if (pyCache) return pyCache;
  const candidates = IS_WIN
    ? [["python"], ["py", "-3"], ["python3"]]
    : [["python3"], ["python"]];
  for (const c of candidates) {
    try {
      const r = Bun.spawnSync([...c, "--version"], { stdout: "pipe", stderr: "pipe" });
      const out = r.stdout.toString() + r.stderr.toString();
      if (r.exitCode === 0 && /Python 3/.test(out)) {
        pyCache = c;
        return c;
      }
    } catch { /* ลองตัวถัดไป */ }
  }
  pyCache = IS_WIN ? ["python"] : ["python3"];
  return pyCache; // ไม่เจอเลย — คืนค่าตาม OS ให้ error ขึ้นชื่อคำสั่งที่คนเครื่องนั้นควรมี
}

/** env ที่ต้องแนบทุกครั้งที่เรียก Python — บังคับ UTF-8 กัน Windows ใช้ cp1252 แล้วพังกับภาษาไทย */
export const PY_ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };

// ── ที่ติดตั้ง CapCut (ใช้ใน doctor) ──────────────────────────────────
export function findCapCutApp(): string | undefined {
  const home = homedir();
  if (IS_WIN) {
    const base = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [join(base, "CapCut", "Apps"), join(base, "CapCut")].find(existsSync);
  }
  return ["/Applications/CapCut.app", join(home, "Applications/CapCut.app")].find(existsSync);
}

// ── โฟลเดอร์ cache ฟอนต์ของ CapCut ────────────────────────────────────
export function fontCacheDirs(): string[] {
  const home = homedir();
  if (IS_WIN) {
    const base = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [join(base, "CapCut", "User Data", "Cache", "effect")];
  }
  return [
    join(home, "Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect"),
    join(home, "Movies/CapCut/User Data/Cache/effect"),
  ];
}
