#!/usr/bin/env python3
"""Validate manifest integrity, requirement coverage, secrets, and demo media."""

from __future__ import annotations

import argparse
import codecs
import hashlib
import json
import math
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

SECRET_PATH = re.compile(
    r"(^|/)(\.env(?:$|\.(?!(?:example|sample|template|dist)$)[^/]+$)|"
    r"id_rsa|id_ed25519|.*\.(pem|p12|pfx)|"
    r"(?:private|secret|server|client|tls|ssl)[^/]*\.key$|cookies?\.json$|"
    r"client_secret[^/]*\.json$|\.npmrc$|\.yarnrc(?:\.yml)?$|\.pypirc$|\.netrc$|"
    r"pip\.conf$|auth\.toml$|credentials\.toml$)",
    re.I,
)
FORBIDDEN_PATH = re.compile(
    r"((^|/)node_modules(/|$)|(^|/)(?:\.git|\.hg|\.svn|\.bzr)(/|$)|"
    r"(^|/)[^/]+\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$|"
    r"(^|/)[^/]*(?:dump|backup)[^/]*\.sql$)",
    re.I,
)
SECRET_TEXT = re.compile(
    r"(-----BEGIN (?:[A-Z0-9]+(?: [A-Z0-9]+)* )?PRIVATE KEY-----|"
    r"xox(?:a|b|p|r|s)-[A-Za-z0-9-]{8,}|"
    r"(?:OPENAI|ANTHROPIC|AWS_SECRET_ACCESS|GITHUB|GH|STRIPE)_[A-Z0-9_]*\s*[=:]\s*['\"]?[A-Za-z0-9_\-/+=]{16,}|"
    r"(?:_auth|_authToken|npmAuthToken)\s*[=:]\s*['\"]?[A-Za-z0-9_\-/+=]{8,}|"
    r"(?:client_secret|clientSecret)['\"]?\s*[=:]\s*['\"]?[A-Za-z0-9_.\-/+=]{8,}|"
    r"[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@[^\s'\"<>]+)",
    re.I,
)
DATABASE_DUMP_TEXT = re.compile(
    r"(?:--\s*(?:PostgreSQL database dump|MySQL dump)|"
    r"PRAGMA\s+foreign_keys\s*=\s*OFF\s*;\s*BEGIN\s+TRANSACTION\s*;)",
    re.I,
)
SRT_TIMING = re.compile(
    r"\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}(?:\s+.*)?"
)
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".mp4", ".mov", ".webm", ".zip"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm"}
TAR_SUFFIXES = (".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz")
UNSUPPORTED_ARCHIVE_SUFFIXES = (".gz", ".bz2", ".xz", ".zst", ".7z", ".rar")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_text_stream(stream, location: str, errors: list[str], warnings: list[str]) -> None:
    decoders = [
        codecs.getincrementaldecoder(encoding)(errors="replace")
        for encoding in ("utf-8", "utf-16-le", "utf-16-be")
    ]
    tails = ["" for _ in decoders]
    credential_found = False
    blocker_found = False
    database_dump_found = False

    def inspect(text: str) -> None:
        nonlocal credential_found, blocker_found, database_dump_found
        if not credential_found and SECRET_TEXT.search(text):
            errors.append(f"possible credential in: {location}")
            credential_found = True
        if not blocker_found and "TODO-BLOCKED:" in text:
            warnings.append(f"unresolved blocker in: {location}")
            blocker_found = True
        if not database_dump_found and DATABASE_DUMP_TEXT.search(text):
            errors.append(f"database dump content in: {location}")
            database_dump_found = True

    while chunk := stream.read(1024 * 1024):
        for index, decoder in enumerate(decoders):
            searchable = tails[index] + decoder.decode(chunk)
            inspect(searchable)
            tails[index] = searchable[-4096:]
    for index, decoder in enumerate(decoders):
        inspect(tails[index] + decoder.decode(b"", final=True))


def has_srt_text(text: str) -> bool:
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


def has_srt_cue(path: Path) -> bool:
    try:
        return has_srt_text(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        return False


def probe_video(
    path: Path, location: str, max_video_seconds: float | None, errors: list[str]
) -> None:
    if not shutil.which("ffprobe"):
        errors.append(f"cannot inspect video without ffprobe: {location}")
        return
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], capture_output=True, text=True)
    if probe.returncode != 0:
        errors.append(f"unreadable video: {location}")
        return
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        errors.append(f"unreadable video duration: {location}")
        return
    if not math.isfinite(duration) or duration <= 0:
        errors.append(f"empty video: {location}")
    if max_video_seconds is not None and duration > max_video_seconds:
        errors.append(f"video exceeds {max_video_seconds}s ({duration:.2f}s): {location}")


def probe_video_stream(
    stream,
    suffix: str,
    location: str,
    max_video_seconds: float | None,
    errors: list[str],
) -> None:
    with tempfile.NamedTemporaryFile(suffix=suffix) as temporary:
        shutil.copyfileobj(stream, temporary)
        temporary.flush()
        probe_video(Path(temporary.name), location, max_video_seconds, errors)


def archive_kind(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".zip"):
        return "zip"
    if lower.endswith(TAR_SUFFIXES):
        return "tar"
    if lower.endswith(UNSUPPORTED_ARCHIVE_SUFFIXES):
        return "unsupported"
    return None


def inspect_zip(
    path: Path,
    relative: str,
    errors: list[str],
    warnings: list[str],
    max_video_seconds: float | None = None,
) -> tuple[int, int]:
    video_count = 0
    caption_count = 0
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
                if suffix in VIDEO_SUFFIXES:
                    video_count += 1
                    with archive.open(member) as stream:
                        probe_video_stream(
                            stream, suffix, location, max_video_seconds, errors
                        )
                elif suffix == ".srt":
                    try:
                        text = archive.read(member).decode("utf-8")
                    except UnicodeDecodeError:
                        errors.append(f"empty or malformed SRT captions: {location}")
                    else:
                        if has_srt_text(text):
                            caption_count += 1
                        else:
                            errors.append(f"empty or malformed SRT captions: {location}")
    except (zipfile.BadZipFile, zipfile.LargeZipFile):
        errors.append(f"unreadable zip archive: {relative}")
    return video_count, caption_count


def inspect_tar(
    path: Path,
    relative: str,
    errors: list[str],
    warnings: list[str],
    max_video_seconds: float | None = None,
) -> tuple[int, int]:
    video_count = 0
    caption_count = 0
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
                if suffix in VIDEO_SUFFIXES:
                    video_count += 1
                    stream = archive.extractfile(member)
                    if stream is None:
                        errors.append(f"archive member cannot be inspected: {location}")
                    else:
                        with stream:
                            probe_video_stream(
                                stream, suffix, location, max_video_seconds, errors
                            )
                elif suffix == ".srt":
                    stream = archive.extractfile(member)
                    if stream is None:
                        errors.append(f"empty or malformed SRT captions: {location}")
                    else:
                        with stream:
                            try:
                                text = stream.read().decode("utf-8")
                            except UnicodeDecodeError:
                                errors.append(f"empty or malformed SRT captions: {location}")
                            else:
                                if has_srt_text(text):
                                    caption_count += 1
                                else:
                                    errors.append(f"empty or malformed SRT captions: {location}")
    except tarfile.TarError:
        errors.append(f"unreadable tar archive: {relative}")
    return video_count, caption_count


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
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            errors.append(f"symbolic link in package: {relative}")
            continue
        if not path.is_file():
            continue
        if FORBIDDEN_PATH.search(relative):
            errors.append(f"forbidden packaged path: {relative}")
        if SECRET_PATH.search(relative):
            errors.append(f"secret-like file path: {relative}")
        kind = archive_kind(path.name)
        if kind == "zip":
            videos, captions = inspect_zip(
                path, relative, errors, warnings, args.max_video_seconds
            )
            video_count += videos
            caption_count += captions
        elif kind == "tar":
            videos, captions = inspect_tar(
                path, relative, errors, warnings, args.max_video_seconds
            )
            video_count += videos
            caption_count += captions
        elif kind == "unsupported":
            errors.append(f"unsupported archive format: {relative}")
        if kind is None and path.suffix.lower() not in BINARY_SUFFIXES:
            with path.open("rb") as stream:
                scan_text_stream(stream, relative, errors, warnings)
        if path.suffix.lower() in VIDEO_SUFFIXES:
            video_count += 1
            probe_video(path, relative, args.max_video_seconds, errors)
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
        errors.append("undeclared files: " + ", ".join(extras))

    result = {"valid": not errors, "errors": errors, "warnings": warnings, "filesChecked": len(declared)}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
