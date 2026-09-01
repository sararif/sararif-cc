#!/usr/bin/env bun
/**
 * cc.ts — ใส่ซับไทยลงโปรเจกต์ CapCut ด้วยคำสั่งเดียว
 *
 * แก้ปัญหาที่พิสูจน์แล้วว่า CapCut ทำเองไม่ได้:
 *   auto-caption ของ CapCut แบ่งซับตาม "ก้อนคลิป" ไม่ได้แบ่งตาม "วลี"
 *   คลิป 45 วิ ได้ซับ 3 ก้อน ก้อนละ 11-20 วินาที ข้อความ 5-7 บรรทัดค้างบนจอทีเดียว
 *   (ทดสอบบนมือถือจริง 31 ส.ค. 69 — ดู Channels/MOBILE_TEST_SHEET.md)
 *
 * ตัวนี้: ถอดเสียง → แบ่งวลีตามกฎไทย (pythainlp + ENDERS/STARTERS) → ใส่ลง CapCut
 *
 * ใช้:
 *   ── ทางฟรี ไม่ต้องติดตั้งอะไร ไม่ต้องมีคีย์ ไม่ต้องใส่ไฟล์คลิป ──
 *   กด Auto captions ใน CapCut ก่อน (ฟรี) → ปิด CapCut → แล้วสั่ง:
 *   bun cc.ts 0831 --engine capcut --dry
 *   bun cc.ts 0831 --engine capcut --track 2        # ถ้ามีข้อความหลายแทร็ก
 *
 *   ── ทางที่เวลาแม่นระดับคำ (ต้องมีคีย์ Scribe / whisper) ──
 *   bun cc.ts 0831 ~/Downloads/IMG_8658.MOV
 *   bun cc.ts 0831 a.MOV b.MOV --engine scribe      # หลายคลิป ต่อกันตามลำดับ
 *   bun cc.ts 0831 a.MOV:0 b.MOV:12.5               # กำหนดจุดเริ่มบนไทม์ไลน์เอง (วินาที)
 *
 * ตัวเลือก:
 *   --engine auto|capcut|local|scribe
 *                                capcut = อ่านซับที่ CapCut ถอดไว้แล้ว (ฟรี ไม่ต้องลงอะไร)
 *                                auto = มี key ใช้ scribe ไม่มีใช้ local (ค่าเริ่มต้น)
 *   --track N                    เลือกแทร็กข้อความ (ใช้กับ --engine capcut)
 *   --maxchars 16                ความยาวสูงสุดต่อบรรทัด
 *   --y -0.80                    ตำแหน่งแนวตั้ง (-1 = ล่างสุด)
 *   --size 15                    ขนาดตัวอักษร
 *   --dry                        ถอดเสียง+แบ่งวลีให้ดู แต่ไม่เขียนลง CapCut
 *
 * ⚠️ ปิด CapCut ก่อนรัน — สคริปต์จะปิดให้เอง ถ้าปิดไม่ได้จะไม่ยอมเขียน
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";

const HOME = homedir();
const HERE = dirname(new URL(import.meta.url).pathname);
const DRAFT_ROOT = join(HOME, "Movies/CapCut/User Data/Projects/com.lveditor.draft");

// สคริปต์ที่ต้องใช้ (stt_*.py, capcut_cc.py) — ใช้ชุดที่แพ็กมาในโฟลเดอร์นี้ก่อน
// ถ้าไม่มี ค่อยถอยไปหาในโปรเจกต์ต้นทาง (สำหรับตอนพัฒนา)
const SCRIPTS =
  process.env.SARARIF_CC_SCRIPTS ||
  [join(HERE, "scripts"), join(HERE, "../../scripts")].find((d) => existsSync(join(d, "capcut_cc.py"))) ||
  join(HERE, "scripts");

const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

const sh = async (cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}) => {
  const p = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: opts.quiet ? "pipe" : "inherit",
    stderr: opts.quiet ? "pipe" : "inherit",
  });
  const out = opts.quiet ? await new Response(p.stdout).text() : "";
  const err = opts.quiet ? await new Response(p.stderr).text() : "";
  return { code: await p.exited, out: out.trim(), err: err.trim() };
};

// ── อ่านอาร์กิวเมนต์ ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const has = (name: string) => argv.includes(`--${name}`);

const positional = argv.filter((a, i) => {
  if (a.startsWith("--")) return false;
  return !(i > 0 && argv[i - 1].startsWith("--") && !["dry"].includes(argv[i - 1].slice(2)));
});

const ENGINE = flag("engine", "auto")!;
// engine=capcut ไม่ต้องมีไฟล์คลิป เพราะอ่านซับที่ CapCut ถอดไว้แล้วในตัวโปรเจกต์
const NEEDS_CLIP = ENGINE !== "capcut";

if (positional.length < (NEEDS_CLIP ? 2 : 1) || has("help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
  process.exit(positional.length < (NEEDS_CLIP ? 2 : 1) ? 1 : 0);
}

const PROJ = positional[0];
const SOURCES = positional.slice(1);
const MAXCHARS = flag("maxchars", "16")!;
const Y = flag("y", "-0.80")!;
const SIZE = flag("size", "15")!;
const DRY = has("dry");

// ── 1. ตรวจเครื่องก่อน ────────────────────────────────────────────────
console.log("🩺 ตรวจเครื่องก่อน…");
const doc = await sh(["bun", join(HERE, "doctor.ts")], { quiet: true });
if (doc.code !== 0) {
  console.log(doc.out);
  die("เครื่องยังไม่พร้อม — แก้ตามที่บอกข้างบนก่อน แล้วรันใหม่");
}
console.log("   ✅ ผ่าน\n");

// ── 2. ตรวจโปรเจกต์ ───────────────────────────────────────────────────
const DRAFT_DIR = join(DRAFT_ROOT, PROJ);
const DRAFT = join(DRAFT_DIR, "draft_info.json");
if (!existsSync(DRAFT)) {
  const available = existsSync(DRAFT_ROOT)
    ? (await sh(["ls", DRAFT_ROOT], { quiet: true })).out.split("\n").filter((x) => x && !x.startsWith(".") && !x.endsWith(".json"))
    : [];
  die(`ไม่พบโปรเจกต์ "${PROJ}"\n   โปรเจกต์ที่มี: ${available.slice(0, 12).join(" · ") || "(ไม่มีเลย)"}`);
}

if (NEEDS_CLIP) {
  for (const s of SOURCES) {
    const f = s.includes(":") ? s.slice(0, s.lastIndexOf(":")) : s;
    if (!existsSync(f)) die(`ไม่พบไฟล์คลิป: ${f}`);
  }
}

// ── 3. คิดจุดเริ่มบนไทม์ไลน์ของแต่ละคลิป ──────────────────────────────
// ถ้าไม่ระบุ :offset เอง → ต่อกันตามลำดับด้วยความยาวจริงของไฟล์
const dur = async (f: string) => {
  const r = await sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { quiet: true });
  return parseFloat(r.out) || 0;
};

type Src = { file: string; offset: number };
const srcs: Src[] = [];
let cursor = 0;
for (const s of NEEDS_CLIP ? SOURCES : []) {
  const idx = s.lastIndexOf(":");
  const explicit = idx > 1 && /^[\d.]+$/.test(s.slice(idx + 1));
  const file = explicit ? s.slice(0, idx) : s;
  const offset = explicit ? parseFloat(s.slice(idx + 1)) : cursor;
  srcs.push({ file, offset });
  cursor = offset + (await dur(file));
}

console.log(`📼 โปรเจกต์: ${PROJ}`);
for (const s of srcs) console.log(`   ${basename(s.file)}  เริ่มที่ ${s.offset.toFixed(1)}s`);

// ── 4. เลือกเครื่องมือถอดเสียง ────────────────────────────────────────
// scribe = แม่นระดับคำ เสียเงิน · local = ฟรี แต่เวลาเพี้ยนขึ้นเรื่อยๆ ตามความยาวคลิป
const envCandidates = [join(HOME, ".sararif-cc.env"), join(HERE, ".env"), join(SCRIPTS, "../.env")];
const hasKey =
  !!process.env.ELEVENLABS_API_KEY ||
  envCandidates.some((f) => existsSync(f) && readFileSync(f, "utf8").includes("ELEVENLABS_API_KEY="));

const engine = ENGINE === "auto" ? (hasKey ? "scribe" : "local") : ENGINE;
if (engine === "scribe" && !hasKey) die("เลือก --engine scribe แต่ไม่พบ ELEVENLABS_API_KEY");
const engineLabel: Record<string, string> = {
  scribe: "ElevenLabs Scribe (แม่นระดับคำ · เสียเงิน ~฿1/คลิป 3 นาที)",
  local: "whisper ในเครื่อง (ฟรี · ต้องติดตั้งเอง)",
  capcut: "ซับที่ CapCut ถอดไว้แล้ว (ฟรี · ไม่ต้องติดตั้งอะไร ไม่ต้องมีคีย์)",
};
console.log(`\n🎙️  แหล่งข้อความ: ${engineLabel[engine] ?? engine}`);
if (engine === "local") {
  console.log("   ⚠️ เวลาของ whisper ในเครื่องคลาดเคลื่อนมากขึ้นตามความยาวคลิป");
  console.log("      คลิปสั้น (~15 วิ) พอใช้ · คลิปยาวควรใช้ scribe");
}
if (engine === "capcut") {
  console.log("   ℹ️ ขอบกล่องเวลาแม่นตามที่ CapCut แบ่งมา ส่วนในกล่องเฉลี่ยตามจำนวนตัวอักษร");
  console.log("      พอสำหรับให้ซับขึ้นตรงจังหวะ · ถ้าต้องเป๊ะระดับคำเพื่อไปตัดต่อ ใช้ scribe");
}

// ── 5. ถอดเสียง ───────────────────────────────────────────────────────
// 🐛 แยกที่เก็บตาม engine — ไม่งั้นเลือก scribe แต่ไปหยิบไฟล์ที่ whisper ถอดไว้มาใช้
//    (เจอตอนทดสอบ 31 ส.ค. 69: รายงานว่าใช้ Scribe แต่ใช้ผลของ whisper ซึ่งเวลาเพี้ยน)
const WORK = join(DRAFT_DIR, ".sararif-cc", engine);
mkdirSync(WORK, { recursive: true });

const sttScript = { scribe: "stt_clips.py", local: "stt_local.py", capcut: "from_capcut.py" }[engine] ?? "stt_local.py";
const sttPath = join(SCRIPTS, sttScript);
if (!existsSync(sttPath)) die(`ไม่พบ ${sttScript}\n   ตั้ง SARARIF_CC_SCRIPTS ให้ชี้ไปโฟลเดอร์ scripts`);

const wordsFor = (f: string) => join(WORK, `${basename(f).replace(/\.[^.]+$/, "")}.words.json`);

// engine=capcut อ่านจากตัวโปรเจกต์ ไม่ใช่จากไฟล์คลิป — จึงมี "แหล่ง" เดียวคือโปรเจกต์เอง
if (engine === "capcut") {
  srcs.push({ file: PROJ, offset: 0 });
  const track = flag("track");
  const args = ["python3", sttPath, PROJ, "--out", WORK, ...(track ? ["--track", track] : [])];
  const r = await sh(args);
  if (r.code === 2) die("โปรเจกต์นี้มีข้อความหลายแทร็ก — เลือกด้วย --track <เลข> ตามที่แสดงข้างบน");
  if (r.code !== 0) die("อ่านซับจาก CapCut ไม่สำเร็จ");
  if (!existsSync(wordsFor(PROJ))) die(`อ่านเสร็จแต่ไม่พบไฟล์ผลลัพธ์: ${wordsFor(PROJ)}`);
}

for (const s of engine === "capcut" ? [] : srcs) {
  if (existsSync(wordsFor(s.file))) {
    console.log(`   ⏭️  ${basename(s.file)} ถอดไว้แล้ว ใช้ของเดิม`);
    continue;
  }
  const r = await sh(["python3", sttPath, s.file, "--out", WORK]);
  if (r.code !== 0) die(`ถอดเสียงล้มเหลว: ${basename(s.file)}`);
  if (!existsSync(wordsFor(s.file))) die(`ถอดเสียงเสร็จแต่ไม่พบไฟล์ผลลัพธ์: ${wordsFor(s.file)}`);
}

// ── 6. โหมดดูก่อน (ไม่เขียนลง CapCut) ─────────────────────────────────
// แบ่งวลีด้วย segment.py (group() เดิม + กฎห้ามคำเชื่อม/บุพบทค้างท้ายบรรทัด)
const segmentOne = async (s: Src) => {
  const r = await sh(
    ["python3", join(HERE, "segment.py"), wordsFor(s.file), "--maxchars", MAXCHARS, "--offset", String(s.offset)],
    { quiet: true },
  );
  if (r.code !== 0) die(`แบ่งวลีล้มเหลว: ${basename(s.file)}\n${r.err}`);
  return r.out.split("\n").filter(Boolean).map((l) => {
    const [st, en, ...rest] = l.split("\t");
    return { st: parseFloat(st), en: parseFloat(en), text: rest.join("\t") };
  });
};

if (DRY) {
  console.log("\n👀 โหมด --dry: แบ่งวลีให้ดู ไม่เขียนลง CapCut\n");
  let n = 0;
  for (const s of srcs) {
    for (const line of await segmentOne(s)) {
      console.log(`  ${line.st.toFixed(1).padStart(6)}s  ${line.text}`);
      n++;
    }
  }
  console.log(`\n✅ รวม ${n} บรรทัด — เอาแฟลก --dry ออกแล้วรันใหม่เพื่อเขียนลง CapCut\n`);
  process.exit(0);
}

// ── 7. ปิด CapCut ก่อนแตะไฟล์ (fail-closed) ───────────────────────────
// CapCut เก็บ draft ทั้งก้อนไว้ในหน่วยความจำ แล้วเขียนทับตอนปิด
// ถ้าเขียนไฟล์ตอนมันเปิดอยู่ = งานหายเงียบๆ ตอนผู้ใช้กด Cmd+Q (เจอจริง 2 ส.ค. 69)
const capcutState = async (): Promise<"running" | "stopped" | "unknown"> => {
  const pg = await sh(["pgrep", "-x", "CapCut"], { quiet: true });
  if (pg.code === 0 && pg.out) return "running";
  if (/cannot get process list|operation not permitted/i.test(pg.err)) return "unknown";
  const ps = await sh(["ps", "-Ao", "command"], { quiet: true });
  if (ps.code !== 0) return "unknown";
  return /MacOS\/CapCut(\s|$)/m.test(ps.out) ? "running" : "stopped";
};

let state = await capcutState();
if (state === "running") {
  console.log("\n🚪 CapCut เปิดอยู่ — ปิดให้ก่อน (ไม่งั้นงานจะถูกเขียนทับหาย)");
  await sh(["osascript", "-e", 'quit app "CapCut"'], { quiet: true });
  for (let i = 0; i < 15 && (await capcutState()) === "running"; i++) await Bun.sleep(400);
  state = await capcutState();
}
if (state !== "stopped") {
  die(
    state === "unknown"
      ? "เช็คไม่ได้ว่า CapCut เปิดอยู่ไหม — ไม่ยอมเขียนไฟล์ (กันงานหาย)\n   ปิด CapCut เองแล้วรันใหม่"
      : "ปิด CapCut ไม่สำเร็จ — ปิดเองแล้วรันใหม่",
  );
}

// ── 8. ใส่ซับลง draft ─────────────────────────────────────────────────
const before = statSync(DRAFT).size;
const ccArgs = ["python3", join(SCRIPTS, "capcut_cc.py"), PROJ];

// ส่งวลีที่แบ่งไว้เองเข้าไป (--phrases) แทนที่จะให้ capcut_cc.py ไปเรียก group() เอง
// เพื่อให้ได้กฎ "ห้ามคำเชื่อมค้างท้ายบรรทัด" ที่ segment.py เพิ่มมา
for (const s of srcs) {
  const lines = await segmentOne(s);
  const pf = join(WORK, `${basename(s.file).replace(/\.[^.]+$/, "")}.phrases.txt`);
  await Bun.write(pf, lines.map((l) => l.text).join("\n") + "\n");
  ccArgs.push("--sub", `${wordsFor(s.file)}:${s.offset}`, "--phrases", `${pf}:${s.offset}`);
}
ccArgs.push("--maxchars", MAXCHARS, "--y", Y, "--size", SIZE);

console.log("\n✍️  ใส่ซับลง CapCut…\n");
const inj = await sh(ccArgs);
if (inj.code !== 0) die("ใส่ซับล้มเหลว — ไฟล์สำรองอยู่ที่ draft_info.json.PRE_CC_BAK");

// ── 9. sync สำเนาใน Timelines/ ────────────────────────────────────────
// CapCut อ่านจากสำเนาในนี้ — เขียนแค่ไฟล์รากคือของหายเงียบๆ (เจอจริง 17 ส.ค. 69)
const draftText = readFileSync(DRAFT, "utf8");
let synced = 0;
for await (const rel of new Bun.Glob("Timelines/*/draft_info.json").scan(DRAFT_DIR)) {
  await Bun.write(join(DRAFT_DIR, rel), draftText);
  synced++;
}

// ── 10. อ่านกลับยืนยัน — ห้ามเชื่อว่า "ไม่ error = สำเร็จ" ─────────────
const draft = JSON.parse(draftText);
const textTracks = (draft.tracks || []).filter((t: any) => t.type === "text");
const lastTrack = textTracks[textTracks.length - 1];
const nLines = lastTrack?.segments?.length ?? 0;
const after = statSync(DRAFT).size;

if (nLines === 0) die("เขียนแล้วแต่อ่านกลับไม่เจอซับสักบรรทัด — กู้จาก draft_info.json.PRE_CC_BAK");
if (after <= before) die(`ไฟล์ไม่โตขึ้น (${before} → ${after} ไบต์) — น่าจะเขียนไม่ติด`);

console.log(`\n✅ เสร็จ — ใส่ซับ ${nLines} บรรทัด · sync Timelines ${synced} ไฟล์`);
console.log(`   ไฟล์สำรอง: ${PROJ}/draft_info.json.PRE_CC_BAK`);
console.log(`\n👉 เปิด CapCut แล้วเปิดโปรเจกต์ "${PROJ}" ดูได้เลย`);
console.log(`   ถ้าซับไม่ขึ้น: ปิด CapCut สนิทก่อนแล้วเปิดใหม่ (มันแคช draft ไว้)\n`);
