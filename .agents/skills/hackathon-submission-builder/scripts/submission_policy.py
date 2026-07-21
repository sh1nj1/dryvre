#!/usr/bin/env python3
"""Shared safety and format policy for hackathon submission tooling."""

from __future__ import annotations

import codecs
import hashlib
import re
import unicodedata
from pathlib import Path, PurePosixPath

RESERVED_OUTPUT_PATHS = frozenset({"manifest.json", "submission-status.md"})
VCS_DIRECTORIES = frozenset({".git", ".hg", ".svn", ".bzr"})
VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".webm"})
BINARY_SUFFIXES = frozenset(
    {".png", ".jpg", ".jpeg", ".gif", ".pdf", *VIDEO_SUFFIXES, ".zip"}
)
TAR_SUFFIXES = (
    ".tar",
    ".tar.gz",
    ".tgz",
    ".tar.bz2",
    ".tbz2",
    ".tar.xz",
    ".txz",
)
UNSUPPORTED_ARCHIVE_SUFFIXES = (".gz", ".bz2", ".xz", ".zst", ".7z", ".rar")

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
    r"(?P<provider_quote>['\"]?)(?:OPENAI|ANTHROPIC|AWS_SECRET_ACCESS|GITHUB|GH|STRIPE)_[A-Z0-9_]*"
    r"(?P=provider_quote)\s*[=:]\s*['\"]?[A-Za-z0-9_\-/+=]{16,}|"
    r"(?:_auth|_authToken|npmAuthToken)\s*[=:]\s*['\"]?[A-Za-z0-9_\-/+=]{8,}|"
    r"(?:client_secret|clientSecret)['\"]?\s*[=:]\s*['\"]?"
    r"[A-Za-z0-9_.\-/+=]{8,}|"
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
WINDOWS_DRIVE_PATH = re.compile(r"^[A-Za-z]:")
WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{index}" for index in range(1, 10)}
    | {f"LPT{index}" for index in range(1, 10)}
)


def normalize_slashes(value: str) -> str:
    return value.replace("\\", "/")


def portable_relative_path(value: str, *, allow_current: bool = False) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"path must be a non-empty string: {value!r}")
    normalized = normalize_slashes(value)
    parts = PurePosixPath(normalized).parts
    if (
        normalized.startswith("/")
        or WINDOWS_DRIVE_PATH.match(normalized)
        or ".." in parts
        or any(ord(character) < 32 for character in normalized)
    ):
        raise ValueError(f"path must be portable and relative: {value!r}")
    for part in parts:
        if (
            ":" in part
            or part.endswith((".", " "))
            or part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES
        ):
            raise ValueError(
                f"path is not portable across supported platforms: {value!r}"
            )
    result = PurePosixPath(normalized).as_posix()
    if result == "." and not allow_current:
        raise ValueError(f"path must name a file or directory: {value!r}")
    return result


def portable_path_key(value: str) -> str:
    portable = portable_relative_path(value, allow_current=True)
    return unicodedata.normalize("NFC", portable).casefold()


def unsafe_archive_member_path(value: str) -> bool:
    try:
        portable_relative_path(value, allow_current=True)
    except ValueError:
        return True
    return False


def path_policy_findings(value: str) -> tuple[str, ...]:
    normalized = normalize_slashes(value)
    findings = []
    if FORBIDDEN_PATH.search(normalized):
        findings.append("forbidden")
    if SECRET_PATH.search(normalized):
        findings.append("secret")
    return tuple(findings)


def archive_kind(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".zip"):
        return "zip"
    if lower.endswith(TAR_SUFFIXES):
        return "tar"
    if lower.endswith(UNSUPPORTED_ARCHIVE_SUFFIXES):
        return "unsupported"
    return None


def path_suffix(name: str) -> str:
    return PurePosixPath(normalize_slashes(name)).suffix.lower()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_text_stream(
    stream, location: str, errors: list[str], warnings: list[str]
) -> None:
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
