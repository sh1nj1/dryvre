#!/usr/bin/env python3
"""Validate manifest integrity, requirement coverage, secrets, and demo media."""

from __future__ import annotations

import argparse
import codecs
import hashlib
import json
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

SECRET_PATH = re.compile(
    r"(^|/)(\.env(?:$|\.(?!(?:example|sample|template|dist)$)[^/]+$)|"
    r"id_rsa|id_ed25519|.*\.(pem|p12)|"
    r"(?:private|secret|server|client|tls|ssl)[^/]*\.key$|cookies?\.json$|"
    r"\.npmrc$|\.yarnrc(?:\.yml)?$|\.pypirc$|\.netrc$|pip\.conf$|auth\.toml$|credentials\.toml$)",
    re.I,
)
FORBIDDEN_PATH = re.compile(
    r"((^|/)node_modules(/|$)|(^|/)(?:\.git|\.hg|\.svn|\.bzr)(/|$)|"
    r"(^|/)[^/]+\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$|"
    r"(^|/)[^/]*(?:dump|backup)[^/]*\.sql$)",
    re.I,
)
SECRET_TEXT = re.compile(
    r"(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    r"(?:OPENAI|ANTHROPIC|AWS_SECRET_ACCESS|GITHUB|GH|STRIPE)_[A-Z0-9_]*\s*[=:]\s*['\"]?[A-Za-z0-9_\-/+=]{16,}|"
    r"(?:_auth|_authToken|npmAuthToken)\s*[=:]\s*['\"]?[A-Za-z0-9_\-/+=]{8,}|"
    r"[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@[^\s'\"<>]+)",
    re.I,
)
DATABASE_DUMP_TEXT = re.compile(r"--\s*(?:PostgreSQL database dump|MySQL dump)", re.I)
SRT_TIMING = re.compile(
    r"\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}(?:\s+.*)?"
)
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".mp4", ".webm", ".zip"}
TAR_SUFFIXES = (".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz")
UNSUPPORTED_ARCHIVE_SUFFIXES = (".gz", ".bz2", ".xz", ".zst", ".7z", ".rar")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_text_stream(stream, location: str, errors: list[str], warnings: list[str]) -> None:
    decoder = codecs.getincrementaldecoder("utf-8")()
    tail = ""
    credential_found = False
    blocker_found = False
    database_dump_found = False
    while chunk := stream.read(1024 * 1024):
        try:
            text = decoder.decode(chunk)
        except UnicodeDecodeError:
            return
        searchable = tail + text
        if not credential_found and SECRET_TEXT.search(searchable):
            errors.append(f"possible credential in: {location}")
            credential_found = True
        if not blocker_found and "TODO-BLOCKED:" in searchable:
            warnings.append(f"unresolved blocker in: {location}")
            blocker_found = True
        if not database_dump_found and DATABASE_DUMP_TEXT.search(searchable):
            errors.append(f"database dump content in: {location}")
            database_dump_found = True
        tail = searchable[-4096:]
    try:
        final = tail + decoder.decode(b"", final=True)
    except UnicodeDecodeError:
        return
    if not credential_found and SECRET_TEXT.search(final):
        errors.append(f"possible credential in: {location}")
    if not blocker_found and "TODO-BLOCKED:" in final:
        warnings.append(f"unresolved blocker in: {location}")
    if not database_dump_found and DATABASE_DUMP_TEXT.search(final):
        errors.append(f"database dump content in: {location}")


def has_srt_cue(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    for block in re.split(r"\r?\n\s*\r?\n", text.strip()):
        lines = block.splitlines()
        if (
            len(lines) >= 3
            and lines[0].strip().isdigit()
            and SRT_TIMING.fullmatch(lines[1].strip())
            and any(line.strip() for line in lines[2:])
        ):
            return True
    return False


def archive_kind(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".zip"):
        return "zip"
    if lower.endswith(TAR_SUFFIXES):
        return "tar"
    if lower.endswith(UNSUPPORTED_ARCHIVE_SUFFIXES):
        return "unsupported"
    return None


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
                    continue
                if FORBIDDEN_PATH.search(member_name):
                    errors.append(f"forbidden archived path: {location}")
                if SECRET_PATH.search(member_name):
                    errors.append(f"secret-like archived path: {location}")
                if member.is_dir():
                    continue
                suffix = PurePosixPath(member_name).suffix.lower()
                if archive_kind(member_name):
                    errors.append(f"nested archive cannot be inspected: {location}")
                    continue
                if member.flag_bits & 0x1:
                    errors.append(f"encrypted archive member cannot be inspected: {location}")
                    continue
                if suffix not in BINARY_SUFFIXES:
                    with archive.open(member) as stream:
                        scan_text_stream(stream, location, errors, warnings)
    except (zipfile.BadZipFile, zipfile.LargeZipFile):
        errors.append(f"unreadable zip archive: {relative}")


def inspect_tar(path: Path, relative: str, errors: list[str], warnings: list[str]) -> None:
    try:
        with tarfile.open(path, "r:*") as archive:
            for member in archive.getmembers():
                member_name = member.name.replace("\\", "/")
                location = f"{relative}!/{member_name}"
                if member_name.startswith("/") or ".." in PurePosixPath(member_name).parts:
                    errors.append(f"unsafe archive member path: {location}")
                if member.issym() or member.islnk():
                    errors.append(f"link in archive: {location}")
                    continue
                if FORBIDDEN_PATH.search(member_name):
                    errors.append(f"forbidden archived path: {location}")
                if SECRET_PATH.search(member_name):
                    errors.append(f"secret-like archived path: {location}")
                if member.isdir():
                    continue
                if not member.isfile():
                    errors.append(f"unsupported archive member: {location}")
                    continue
                if archive_kind(member_name):
                    errors.append(f"nested archive cannot be inspected: {location}")
                    continue
                suffix = PurePosixPath(member_name).suffix.lower()
                if suffix not in BINARY_SUFFIXES:
                    stream = archive.extractfile(member)
                    if stream is None:
                        errors.append(f"archive member cannot be inspected: {location}")
                        continue
                    with stream:
                        scan_text_stream(stream, location, errors, warnings)
    except tarfile.TarError:
        errors.append(f"unreadable tar archive: {relative}")


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
        kind = archive_kind(path.name)
        if kind == "zip":
            inspect_zip(path, relative, errors, warnings)
        elif kind == "tar":
            inspect_tar(path, relative, errors, warnings)
        elif kind == "unsupported":
            errors.append(f"unsupported archive format: {relative}")
        if kind is None and path.suffix.lower() not in BINARY_SUFFIXES:
            with path.open("rb") as stream:
                scan_text_stream(stream, relative, errors, warnings)
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
            if has_srt_cue(path):
                caption_count += 1
            else:
                errors.append(f"empty or malformed SRT captions: {relative}")

    if video_count and not caption_count:
        errors.append("video is present but no valid SRT caption file was packaged")

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
