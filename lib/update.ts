/**
 * update.ts — บอกผู้ใช้ว่ามีเวอร์ชันใหม่แล้ว
 *
 * ออกแบบให้ "เงียบและไม่ขวางงาน" เป็นหลัก:
 *   · เช็ควันละครั้งพอ — จำผลไว้ที่ ~/.sararif-cc/.update-check
 *   · เน็ตล่ม/ช้า/GitHub ล่ม = เงียบ ไม่ขึ้นอะไร ไม่ทำให้คำสั่งหลักพัง (timeout 2 วิ)
 *   · พิมพ์ "ท้ายสุด" หลังงานจริงเสร็จ ไม่แทรกกลางผลลัพธ์
 *   · ปิดได้ด้วย SARARIF_CC_NO_UPDATE_CHECK=1 หรือ --no-update-check
 *
 * ทำไมต้องมี: คนใช้ติดตั้งด้วย `git clone` แล้วไม่มีอะไรบอกว่ามีของใหม่
 * กฎการตัดซับถูกปรับจากการเทียบกับซับที่คนตัดเองเรื่อยๆ — ถ้าไม่ `git pull`
 * ก็ยังเจอบั๊กเดิมที่แก้ไปแล้ว โดยไม่รู้ตัว
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = join(HERE, "..", "VERSION");
const CACHE_DIR = join(homedir(), ".sararif-cc");
const CACHE = join(CACHE_DIR, ".update-check");
const REMOTE = "https://raw.githubusercontent.com/sararif/sararif-cc/main/VERSION";
const DAY_MS = 24 * 60 * 60 * 1000;

export function localVersion(): string {
  try {
    return readFileSync(VERSION_FILE, "utf8").trim();
  } catch {
    return "0.0.0";
  }
}

/** "1.2.3" → [1,2,3] · ส่วนที่ไม่ใช่ตัวเลขนับเป็น 0 เพื่อไม่ให้ throw */
function parts(v: string): number[] {
  return v.split(".").map((x) => parseInt(x, 10) || 0);
}

function isNewer(remote: string, local: string): boolean {
  const [a, b] = [parts(remote), parts(local)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * คืนข้อความแจ้งเตือน หรือ null ถ้าไม่มีอะไรต้องบอก
 * ไม่ throw เด็ดขาด — ทุก error กลืนหมด เพราะนี่เป็นของเสริม ไม่ใช่งานหลัก
 */
export async function updateNotice(): Promise<string | null> {
  try {
    if (process.env.SARARIF_CC_NO_UPDATE_CHECK === "1") return null;
    if (process.argv.includes("--no-update-check")) return null;

    const local = localVersion();
    let latest = "";

    // ใช้ผลที่จำไว้ถ้ายังไม่ถึง 24 ชม. — ไม่ยิงเน็ตทุกครั้งที่รันคำสั่ง
    let cached: { at?: number; latest?: string } = {};
    try {
      if (existsSync(CACHE)) cached = JSON.parse(readFileSync(CACHE, "utf8"));
    } catch {}

    if (cached.at && Date.now() - cached.at < DAY_MS) {
      latest = cached.latest || "";
    } else {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2000);
      try {
        const r = await fetch(REMOTE, { signal: ctl.signal, headers: { "cache-control": "no-cache" } });
        if (r.ok) latest = (await r.text()).trim();
      } catch {
        // เน็ตไม่ได้/ช้า/ถูกบล็อก — เงียบไป
      } finally {
        clearTimeout(t);
      }
      // จดเวลาไว้เสมอ แม้ดึงไม่สำเร็จ — จะได้ไม่ยิงซ้ำทุกครั้งที่เน็ตมีปัญหา
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(CACHE, JSON.stringify({ at: Date.now(), latest }), "utf8");
      } catch {}
    }

    if (!latest || !isNewer(latest, local)) return null;
    return [
      "",
      `\x1b[33m┌─ มีเวอร์ชันใหม่: ${local} → ${latest}\x1b[0m`,
      `\x1b[33m│  อัปเดต:\x1b[0m cd ${join(HERE, "..")} && git pull`,
      `\x1b[33m│  มีอะไรใหม่:\x1b[0m https://github.com/sararif/sararif-cc/blob/main/CHANGELOG.md`,
      `\x1b[90m└─ ไม่อยากให้เตือน: SARARIF_CC_NO_UPDATE_CHECK=1\x1b[0m`,
    ].join("\n");
  } catch {
    return null;
  }
}

/** เรียกท้ายคำสั่ง — พิมพ์ถ้ามีของใหม่ ไม่มีก็ไม่ทำอะไร */
export async function printUpdateNotice(): Promise<void> {
  const msg = await updateNotice();
  if (msg) console.log(msg);
}
