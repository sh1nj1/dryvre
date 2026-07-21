#!/usr/bin/env python3
"""Validate manifest integrity, requirement coverage, secrets, and demo media."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath

SECRET_PATH = re.compile(r"(^|/)(\.env($|\.)|id_rsa|id_ed25519|.*\.(pem|key|p12)|cookies?\.json$)", re.I)
FORBIDDEN_PATH = re.compile(r"(^|/)node_modules(/|$)", re.I)
SECRET_TEXT = re.compile(
    r"(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    r"(?:OPENAI|ANTHROPIC|AWS_SECRET_ACCESS|GITHUB|GH|STRIPE)_[A-Z0-9_]*\s*[=:]\s*['\"]?[A-Za-z0-9_\-/+=]{16,})",
    re.I,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_zip(path: Path, relative: str, errors: list[str], warnings: list[str]) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                member_name = member.filename.replace("\\", "/")
                location = f"{relative}!/{member_name}"
                if member_name.startswith("/") or ".." in PurePosixPath(member_name).parts:
                    errors.append(f"unsafe archive member path: {location}")
                if stat.S_ISLNK(member.external_attr >> 16):
                    errors.append(f"symbolic link in archive: {location}")
                if FORBIDDEN_PATH.search(member_name):
                    errors.append(f"forbidden archived path: {location}")
                if SECRET_PATH.search(member_name):
                    errors.append(f"secret-like archived path: {location}")
                if member.is_dir():
                    continue
                suffix = PurePosixPath(member_name).suffix.lower()
                if suffix == ".zip":
                    errors.append(f"nested archive cannot be inspected: {location}")
                    continue
                if member.flag_bits & 0x1:
                    errors.append(f"encrypted archive member cannot be inspected: {location}")
                    continue
                if member.file_size <= 2_000_000 and suffix not in {
                    ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".mp4", ".webm",
                }:
                    try:
                        text = archive.read(member).decode("utf-8")
                    except UnicodeDecodeError:
                        continue
                    if SECRET_TEXT.search(text):
                        errors.append(f"possible credential in archive: {location}")
                    if "TODO-BLOCKED:" in text:
                        warnings.append(f"unresolved blocker in archive: {location}")
    except (zipfile.BadZipFile, zipfile.LargeZipFile):
        errors.append(f"unreadable zip archive: {relative}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--max-video-seconds", type=float)
    args = parser.parse_args()
    root = args.output_dir.resolve()
    manifest_path = root / "manifest.json"
    errors: list[str] = []
    warnings: list[str] = []
    if not manifest_path.exists():
        print("error: manifest.json is missing", file=sys.stderr)
        return 2
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if any(item.get("required") for item in manifest.get("missing", [])):
        errors.append("manifest contains missing required artifacts")
    for requirement in manifest.get("requirements", []):
        if requirement.get("required", True) and not requirement.get("covered"):
            errors.append(f"required requirement is uncovered: {requirement.get('id')}")

    declared = set()
    video_count = 0
    caption_count = 0
    for artifact in manifest.get("artifacts", []):
        for entry in artifact.get("files", []):
            relative = entry["path"]
            declared.add(relative)
            path = (root / relative).resolve()
            try:
                path.relative_to(root)
            except ValueError:
                errors.append(f"manifest path escapes output: {relative}")
                continue
            if not path.is_file():
                errors.append(f"declared file is missing: {relative}")
            elif sha256(path) != entry.get("sha256"):
                errors.append(f"checksum mismatch: {relative}")

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if FORBIDDEN_PATH.search(relative):
            errors.append(f"forbidden packaged path: {relative}")
        if SECRET_PATH.search(relative):
            errors.append(f"secret-like file path: {relative}")
        if path.suffix.lower() == ".zip":
            inspect_zip(path, relative, errors, warnings)
        if path.stat().st_size <= 2_000_000 and path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".mp4", ".webm", ".zip"}:
            try:
                text = path.read_text(encoding="utf-8")
                if SECRET_TEXT.search(text):
                    errors.append(f"possible credential in: {relative}")
                if "TODO-BLOCKED:" in text:
                    warnings.append(f"unresolved blocker in: {relative}")
            except UnicodeDecodeError:
                pass
        if path.suffix.lower() == ".mp4":
            video_count += 1
            if not shutil.which("ffprobe"):
                errors.append(f"cannot inspect video without ffprobe: {relative}")
                continue
            probe = subprocess.run([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ], capture_output=True, text=True)
            if probe.returncode != 0:
                errors.append(f"unreadable video: {relative}")
            else:
                duration = float(probe.stdout.strip())
                if duration <= 0:
                    errors.append(f"empty video: {relative}")
                if args.max_video_seconds and duration > args.max_video_seconds:
                    errors.append(f"video exceeds {args.max_video_seconds}s ({duration:.2f}s): {relative}")
        elif path.suffix.lower() == ".srt":
            caption_count += 1

    if video_count and not caption_count:
        errors.append("video is present but no SRT caption file was packaged")

    for fixed in ("manifest.json", "submission-status.md"):
        declared.add(fixed)
    extras = sorted(
        path.relative_to(root).as_posix() for path in root.rglob("*")
        if path.is_file() and path.relative_to(root).as_posix() not in declared
    )
    if extras:
        warnings.append("undeclared files: " + ", ".join(extras))

    result = {"valid": not errors, "errors": errors, "warnings": warnings, "filesChecked": len(declared)}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
