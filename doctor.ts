#!/usr/bin/env bun
/**
 * doctor.ts — ตรวจเครื่องก่อนใช้ sararif-cc (ใส่ซับไทยลง CapCut อัตโนมัติ)
 *
 * ทำไมต้องมี: ถ้าแจกเครื่องมือให้คนอื่นแล้วเขารันไม่ได้ เขาจะทักมาถามทีละคน
 * ตัวนี้ตอบแทนว่า "ขาดอะไร และแก้ยังไง" — เป็นด่านแรกเสมอ
 *
 * ใช้:  bun doctor.ts
 * ออก:  0 = พร้อมใช้ · 1 = ขาดของจำเป็น
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const DRAFT_ROOT = join(HOME, "Movies/CapCut/User Data/Projects/com.lveditor.draft");

type Level = "required" | "optional";
type Check = { name: string; ok: boolean; detail: string; fix?: string; level: Level };
const checks: Check[] = [];

const run = async (cmd: string[]): Promise<{ ok: boolean; out: string }> => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    return { ok: (await p.exited) === 0, out: out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
};

const add = (c: Check) => checks.push(c);

// ── 1. ระบบปฏิบัติการ ────────────────────────────────────────────────
// path ของ CapCut และวิธีเช็คโปรเซสเป็นของ macOS ล้วน — Windows ยังใช้ไม่ได้
const isMac = platform() === "darwin";
add({
  name: "ระบบปฏิบัติการ",
  ok: isMac,
  detail: isMac ? "macOS ✓" : `${platform()} — ยังไม่รองรับ`,
  fix: "ตอนนี้รองรับเฉพาะ Mac เพราะ path ของ CapCut และวิธีปิดโปรแกรมเป็นของ macOS\n" +
       "   ถ้าใช้ Windows: ให้ Claude ช่วยแก้ path ใน capcut_cc.py เป็น %LOCALAPPDATA% และเปลี่ยน pgrep เป็น tasklist",
  level: "required",
});

// ── 2. Bun ───────────────────────────────────────────────────────────
const bunV = await run(["bun", "--version"]);
add({
  name: "Bun",
  ok: bunV.ok,
  detail: bunV.ok ? `v${bunV.out}` : "ไม่พบ",
  fix: 'curl -fsSL https://bun.sh/install | bash',
  level: "required",
});

// ── 3. Python 3 ──────────────────────────────────────────────────────
const py = await run(["python3", "--version"]);
add({
  name: "Python 3",
  ok: py.ok,
  detail: py.ok ? py.out : "ไม่พบ",
  fix: "Mac มีมาให้อยู่แล้ว ถ้าไม่มีให้ลง Xcode Command Line Tools: xcode-select --install",
  level: "required",
});

// ── 4. pythainlp — ตัวตัดคำไทย หัวใจของการแบ่งวลี ────────────────────
const ptn = await run(["python3", "-c", "import pythainlp;print(pythainlp.__version__)"]);
add({
  name: "pythainlp (ตัดคำไทย)",
  ok: ptn.ok,
  detail: ptn.ok ? `v${ptn.out}` : "ไม่พบ",
  fix: "python3 -m pip install pythainlp",
  level: "required",
});

// ── 4b. คลังคำของผู้ใช้ — คำที่สอนมันไว้เอง ───────────────────────────
const wordsFile = join(HOME, ".sararif-cc/words.txt");
const fixFile = join(HOME, ".sararif-cc/fix.txt");
const countLines = (f: string) =>
  existsSync(f)
    ? readFileSync(f, "utf8").split("\n").filter((l) => l.split("#")[0].trim()).length
    : 0;
const nWords = countLines(wordsFile), nFix = countLines(fixFile);
add({
  name: "คำที่สอนไว้เอง (ชื่อร้าน/ชื่อคน)",
  ok: true,
  detail: nWords || nFix ? `${nWords} คำ · แก้คำผิด ${nFix} คู่` : "ยังไม่ได้ใส่ (ไม่ใส่ก็ใช้ได้)",
  fix: `ใส่ชื่อร้าน/ชื่อคนที่ไม่อยากให้ซับตัดขาดกลาง 1 บรรทัด 1 คำ ที่ ~/.sararif-cc/words.txt
   และคำที่ถอดเสียงมาผิดบ่อย (รูปแบบ  ผิด = ถูก) ที่ ~/.sararif-cc/fix.txt`,
  level: "optional",
});

// ── 5. ffmpeg — แปลงเสียงก่อนถอด ─────────────────────────────────────
const ff = await run(["ffmpeg", "-version"]);
add({
  name: "ffmpeg",
  ok: ff.ok,
  detail: ff.ok ? ff.out.split("\n")[0].slice(0, 40) : "ไม่พบ",
  fix: "brew install ffmpeg  (ถ้ายังไม่มี Homebrew: https://brew.sh)",
  level: "required",
});

// ── 6. CapCut ────────────────────────────────────────────────────────
const capcutApp = ["/Applications/CapCut.app", join(HOME, "Applications/CapCut.app")].find(existsSync);
add({
  name: "CapCut (เวอร์ชันคอม)",
  ok: !!capcutApp,
  detail: capcutApp ?? "ไม่พบใน /Applications",
  fix: "โหลดจาก capcut.com แล้วเปิดสร้างโปรเจกต์ 1 ครั้งก่อน",
  level: "required",
});

// ── 7. โฟลเดอร์โปรเจกต์ CapCut ───────────────────────────────────────
// ต้องเคยเปิด CapCut สร้างโปรเจกต์อย่างน้อย 1 ครั้ง โฟลเดอร์ถึงจะถูกสร้าง
const draftOk = existsSync(DRAFT_ROOT);
let projCount = 0;
if (draftOk) {
  const ls = await run(["ls", DRAFT_ROOT]);
  projCount = ls.out.split("\n").filter((x) => x.trim() && !x.startsWith(".")).length;
}
add({
  name: "โฟลเดอร์โปรเจกต์ CapCut",
  ok: draftOk,
  detail: draftOk ? `พบ ${projCount} โปรเจกต์` : "ยังไม่มี",
  fix: "เปิด CapCut แล้วสร้างโปรเจกต์ใหม่ 1 อันก่อน โฟลเดอร์จะถูกสร้างให้เอง",
  level: "required",
});

// ── 8. ฟอนต์ที่สคริปต์ใช้ (ไม่มีก็ยังรันได้ แต่ซับจะเป็นฟอนต์ default) ──
// ⚠️ path นี้เป็น cache ของ CapCut แต่ละเครื่อง — ของคนอื่นจะไม่ตรงกัน
const FONT = join(HOME, "Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect/7545362452553174273/f413de54c1c5ef9baabd5a5188b9dd4c/font.ttf");
add({
  name: 'ฟอนต์ "มหานคร"',
  ok: existsSync(FONT),
  detail: existsSync(FONT) ? "พบ" : "ไม่พบบนเครื่องนี้",
  fix: "เปิด CapCut → ใส่ข้อความ → เลือกฟอนต์ มหานคร 1 ครั้ง (CapCut จะโหลดมาเก็บไว้)\n" +
       "   ถ้าไม่ทำ ซับจะยังขึ้นแต่ใช้ฟอนต์ default",
  level: "optional",
});

// ── 9. ถอดเสียง — ต้องมีอย่างน้อย 1 ทาง ──────────────────────────────
// key อาจอยู่ได้หลายที่ — ตรวจให้ครบ ไม่งั้นคนที่มีอยู่แล้วจะโดนบอกว่าไม่มี
const HERE = new URL(".", import.meta.url).pathname;
const envCandidates = [
  join(HOME, ".sararif-cc.env"),
  join(HERE, ".env"),
  join(HERE, "../../.env"),          // _automation/.env (ที่ stt_clips.py อ่าน)
  join(HOME, ".sainua/env"),
];
let keyWhere = process.env.ELEVENLABS_API_KEY ? "environment" : "";
if (!keyWhere) {
  for (const f of envCandidates) {
    if (existsSync(f) && (await Bun.file(f).text()).includes("ELEVENLABS_API_KEY=")) {
      keyWhere = f.replace(HOME, "~");
      break;
    }
  }
}
add({
  name: "ElevenLabs API key (ถอดเสียงแม่นระดับคำ)",
  ok: !!keyWhere,
  detail: keyWhere || "ไม่พบ",
  fix: `ใส่บรรทัด ELEVENLABS_API_KEY=... ในไฟล์ ${join(HOME, ".sararif-cc.env").replace(HOME, "~")}\n` +
       "   (เสียเงินตามใช้ ~฿1 ต่อคลิป 3 นาที — ใช้ key ของตัวเอง)",
  level: "optional",
});

const whisperCandidates = [
  process.env.WHISPER_CLI ?? "",
  join(HERE, "whispercpp/build/bin/whisper-cli"),
  join(HERE, "../../whispercpp/build/bin/whisper-cli"),
  "/opt/homebrew/bin/whisper-cli",   // brew: Apple Silicon
  "/usr/local/bin/whisper-cli",      // brew: Intel Mac
  join(HOME, "whisper.cpp/build/bin/whisper-cli"),
  join(HOME, "whispercpp/build/bin/whisper-cli"),
].filter(Boolean);
const whisperAt = whisperCandidates.find(existsSync);

const modelName = "ggml-large-v3-turbo.bin";
const modelCandidates = [
  process.env.WHISPER_MODEL ?? "",
  join(HERE, "models", modelName),
  join(HOME, ".sararif-cc/models", modelName),
  join(HOME, "whisper.cpp/models", modelName),
].filter(Boolean);
const modelAt = modelCandidates.find(existsSync);

add({
  name: "whisper.cpp (ถอดเสียงฟรีในเครื่อง)",
  ok: !!whisperAt && !!modelAt,
  detail: !whisperAt ? "ไม่พบตัวโปรแกรม"
        : !modelAt ? `เจอโปรแกรมแล้ว (${whisperAt.replace(HOME, "~")}) แต่ยังไม่มีไฟล์โมเดล`
        : `${whisperAt.replace(HOME, "~")} + โมเดลครบ`,
  fix: (!whisperAt ? "1) ติดตั้งโปรแกรม:  brew install whisper-cpp\n   " : "") +
       (!modelAt ? `${whisperAt ? "" : "2) "}โหลดโมเดล (~1.5GB):\n` +
         `      mkdir -p ~/.sararif-cc/models\n` +
         `      curl -L -o ~/.sararif-cc/models/${modelName} \\\n` +
         `        https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}\n   ` : "") +
       "หมายเหตุ: บางเครื่องต้องใส่ธง -ng ปิด GPU ไม่งั้นได้ข้อความมั่ว (สคริปต์ใส่ให้แล้ว)",
  level: "optional",
});

// ── รายงาน ───────────────────────────────────────────────────────────
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));
console.log("\n🩺 ตรวจเครื่องก่อนใช้ sararif-cc\n" + "─".repeat(52));

for (const c of checks) {
  const mark = c.ok ? "✅" : c.level === "required" ? "❌" : "⚠️ ";
  console.log(`${mark} ${pad(c.name, 34)} ${c.detail}`);
}

const missingReq = checks.filter((c) => !c.ok && c.level === "required");
const missingOpt = checks.filter((c) => !c.ok && c.level === "optional");

// ทางที่จะได้ "ข้อความ + เวลา" มามี 3 ทาง — ทางที่ 3 ฟรีและไม่ต้องติดตั้งอะไรเลย
// จึงไม่บล็อกใครที่มีแค่ CapCut (คนส่วนใหญ่อยู่ตรงนี้)
const hasKeyPath = checks.some((c) => c.name.startsWith("ElevenLabs") && c.ok);
const hasWhisperPath = checks.some((c) => c.name.startsWith("whisper.cpp") && c.ok);
const hasCapcutPath = checks.some((c) => c.name.startsWith("CapCut") && c.ok);
const noStt = !hasKeyPath && !hasWhisperPath && !hasCapcutPath;

console.log("─".repeat(52));

if (!hasKeyPath && !hasWhisperPath && hasCapcutPath) {
  console.log("\n💡 ยังไม่มีทางถอดเสียงแบบเสียเงินหรือ whisper — ไม่เป็นไร ใช้ทางฟรีได้เลย:\n");
  console.log("   ให้ CapCut ถอดให้ก่อน (ฟรี ไม่ต้องติดตั้งอะไร):");
  console.log("     CapCut → เลือกคลิป → Text → Auto captions → ภาษาไทย → ปิด CapCut ให้สนิท");
  console.log("   แล้วสั่ง:");
  console.log("     bun cc.ts <ชื่อโปรเจกต์> --engine capcut --dry\n");
  console.log("   อยากได้เวลาเป๊ะระดับคำเพื่อไปตัดต่อ ค่อยเติมคีย์ Scribe ทีหลังได้ (~฿1/คลิป 3 นาที)\n");
}

if (missingReq.length || noStt) {
  console.log("\n🔴 ยังใช้ไม่ได้ — ต้องแก้ก่อน:\n");
  for (const c of missingReq) console.log(`  • ${c.name}\n    → ${c.fix}\n`);
  if (noStt) {
    console.log("  • ไม่มีทางได้ข้อความมาเลยสักทาง — เลือกทางใดทางหนึ่ง:\n");
    console.log("    ทาง A · ฟรี ไม่ต้องติดตั้งอะไร (แนะนำถ้าเพิ่งเริ่ม)");
    console.log("      ติดตั้ง CapCut เวอร์ชันคอมจาก capcut.com แล้วใช้ Auto captions ของมัน");
    console.log("      จากนั้น:  bun cc.ts <โปรเจกต์> --engine capcut\n");
    console.log("    ทาง B · เสียเงินนิดเดียว ~฿1 ต่อคลิป 3 นาที · เวลาแม่นระดับคำ");
    console.log(`      echo 'ELEVENLABS_API_KEY=คีย์ของคุณ' > ${join(HOME, ".sararif-cc.env").replace(HOME, "~")}`);
    console.log("      สมัคร/เอาคีย์ที่ https://elevenlabs.io\n");
    const macVer = Number((Bun.spawnSync(["sw_vers", "-productVersion"]).stdout.toString().split(".")[0]) || 0);
    console.log(`    ทาง C · ฟรี แต่เวลาเพี้ยน ใช้เลือกจุดตัดต่อไม่ได้${
      macVer && macVer < 14 ? ` · ⚠️ เครื่องนี้ macOS ${macVer} ต้อง compile เอง 20–40 นาที` : ""}`);
    console.log("      brew install whisper-cpp");
    console.log("      mkdir -p ~/.sararif-cc/models");
    console.log(`      curl -L -o ~/.sararif-cc/models/${modelName} \\`);
    console.log(`        https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}\n`);
  }
  process.exit(1);
}

if (missingOpt.length) {
  console.log("\n⚠️  ใช้ได้ แต่ยังขาดของเสริม:\n");
  for (const c of missingOpt) console.log(`  • ${c.name}\n    → ${c.fix}\n`);
}

console.log("\n✅ พร้อมใช้งาน\n");

// เพิ่งโหลดมาแล้วยังไม่เคยตั้งค่า → บอกให้รู้ว่าทุกอย่างปรับได้ ไม่ใช่ของตายตัว
if (!existsSync(join(HOME, ".sararif-cc/format.json"))) {
  console.log("────────────────────────────────────────────────────");
  console.log("👉 ยังไม่เคยตั้งค่า — สั่ง  bun setup.ts  สักครั้ง");
  console.log("   มันจะบอกว่าปรับอะไรได้บ้าง (ความยาวคลิป · ขนาดซับ · สีคำเน้น ฯลฯ)");
  console.log("   ค่าพวกนี้ไม่ใช่ของตายตัว ตั้งเป็นของคุณเองได้ทั้งหมด");
  console.log("────────────────────────────────────────────────────\n");
} else {
  console.log("   ดูว่าปรับอะไรได้บ้าง:  bun setup.ts --show\n");
}
process.exit(0);
