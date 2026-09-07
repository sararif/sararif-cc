"""capcut_paths.py — path ของ CapCut ตาม OS รวมไว้ที่เดียว (ฝั่ง Python)

คู่กับ lib/platform.ts ฝั่ง TypeScript — แก้ path ที่ไหนต้องแก้ทั้ง 2 ไฟล์

ความต่างที่ยืนยันแล้ว:
  Mac:     ~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<proj>/draft_info.json
  Windows: %LOCALAPPDATA%\\CapCut\\User Data\\Projects\\com.lveditor.draft\\<proj>\\draft_content.json

เครื่องที่ path ไม่ตรงมาตรฐาน: ตั้ง SARARIF_CC_DRAFT_ROOT ชี้ไปโฟลเดอร์ com.lveditor.draft
"""
import os
import pathlib
import sys

IS_WIN = sys.platform == "win32"


def draft_root() -> pathlib.Path:
    env = os.environ.get("SARARIF_CC_DRAFT_ROOT")
    if env:
        return pathlib.Path(env)
    if IS_WIN:
        base = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
        return pathlib.Path(base) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
    return pathlib.Path.home() / "Movies/CapCut/User Data/Projects/com.lveditor.draft"


def draft_file(proj: str) -> pathlib.Path:
    """ไฟล์ draft ของโปรเจกต์ — Windows ชื่อ draft_content.json, Mac ชื่อ draft_info.json
    ดูของจริงในโฟลเดอร์ก่อน ตรงไหนมีไฟล์ใช้ตัวนั้น (กันเวอร์ชัน CapCut แปลกๆ)"""
    d = draft_root() / proj
    prefer = "draft_content.json" if IS_WIN else "draft_info.json"
    other = "draft_info.json" if prefer == "draft_content.json" else "draft_content.json"
    if (d / prefer).exists():
        return d / prefer
    if (d / other).exists():
        return d / other
    return d / prefer  # ยังไม่มีไฟล์ — คืนชื่อตาม OS ไว้ใช้ในข้อความ error


def font_cache_dirs() -> list:
    """โฟลเดอร์ cache ฟอนต์ของ CapCut ตาม OS"""
    if IS_WIN:
        base = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
        return [pathlib.Path(base) / "CapCut" / "User Data" / "Cache" / "effect"]
    return [
        pathlib.Path.home() / "Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/effect",
        pathlib.Path.home() / "Movies/CapCut/User Data/Cache/effect",
    ]


def force_utf8_stdio():
    """Windows console/pipe ใช้ code page ท้องถิ่น (cp874/cp1252) — พิมพ์ไทยแล้วพัง
    เรียกตัวนี้ที่หัวสคริปต์ทุกตัวที่พิมพ์ภาษาไทย"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
