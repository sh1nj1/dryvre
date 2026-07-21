#!/usr/bin/env python3
"""Validate manifest integrity, safety policy, archives, and demo media."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable, IO

from submission_policy import (
    BINARY_SUFFIXES,
    RESERVED_OUTPUT_PATHS,
    VIDEO_SUFFIXES,
    archive_kind,
    has_srt_cue,
    has_srt_text,
    path_policy_findings,
    path_suffix,
    portable_path_key,
    portable_relative_path,
    scan_text_stream,
    sha256,
    unsafe_archive_member_path,
)


def probe_video(
    path: Path, location: str, max_video_seconds: float | None, errors: list[str]
) -> None:
    if not shutil.which("ffprobe"):
        errors.append(f"cannot inspect video without ffprobe: {location}")
        return
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        errors.append(f"unreadable video: {location}")
        return
    try:
        metadata = json.loads(probe.stdout)
        duration = float(metadata.get("format", {}).get("duration", ""))
    except (ValueError, TypeError, json.JSONDecodeError):
        errors.append(f"unreadable video duration: {location}")
        return
    if not any(
        stream.get("codec_type") == "video" for stream in metadata.get("streams", [])
    ):
        errors.append(f"no video stream: {location}")
    if not math.isfinite(duration) or duration <= 0:
        errors.append(f"empty video: {location}")
    if max_video_seconds is not None and duration > max_video_seconds:
        errors.append(
            f"video exceeds {max_video_seconds}s ({duration:.2f}s): {location}"
        )


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


def apply_path_policy(name: str, location: str, errors: list[str]) -> None:
    findings = path_policy_findings(name)
    if "forbidden" in findings:
        errors.append(f"forbidden archived path: {location}")
    if "secret" in findings:
        errors.append(f"secret-like archived path: {location}")


def inspect_archive_member(
    *,
    name: str,
    archive_location: str,
    stream_factory: Callable[[], IO[bytes] | None],
    errors: list[str],
    warnings: list[str],
    max_video_seconds: float | None,
    is_directory: bool = False,
    is_link: bool = False,
    is_regular: bool = True,
    is_encrypted: bool = False,
) -> tuple[int, int]:
    member_name = name.replace("\\", "/")
    location = f"{archive_location}!/{member_name}"
    if unsafe_archive_member_path(member_name):
        errors.append(f"unsafe archive member path: {location}")
    if is_link:
        errors.append(f"link in archive: {location}")
        return 0, 0
    apply_path_policy(member_name, location, errors)
    if is_directory:
        return 0, 0
    if not is_regular:
        errors.append(f"unsupported archive member: {location}")
        return 0, 0
    if archive_kind(member_name):
        errors.append(f"nested archive cannot be inspected: {location}")
        return 0, 0
    if is_encrypted:
        errors.append(f"encrypted archive member cannot be inspected: {location}")
        return 0, 0

    suffix = path_suffix(member_name)

    def open_member():
        stream = stream_factory()
        if stream is None:
            errors.append(f"archive member cannot be inspected: {location}")
        return stream

    if suffix not in BINARY_SUFFIXES:
        stream = open_member()
        if stream is not None:
            with stream:
                scan_text_stream(stream, location, errors, warnings)

    video_count = 0
    caption_count = 0
    if suffix in VIDEO_SUFFIXES:
        video_count = 1
        stream = open_member()
        if stream is not None:
            with stream:
                probe_video_stream(stream, suffix, location, max_video_seconds, errors)
    elif suffix == ".srt":
        stream = open_member()
        if stream is not None:
            with stream:
                try:
                    text = stream.read().decode("utf-8")
                except UnicodeDecodeError:
                    errors.append(f"empty or malformed SRT captions: {location}")
                else:
                    if has_srt_text(text):
                        caption_count = 1
                    else:
                        errors.append(f"empty or malformed SRT captions: {location}")
    return video_count, caption_count


def validate_archive_member_plan(
    members: list[tuple[str, bool]], archive_location: str, errors: list[str]
) -> None:
    planned: dict[str, tuple[str, bool]] = {}
    for raw_name, is_directory in members:
        try:
            name = portable_relative_path(raw_name, allow_current=True)
        except ValueError:
            continue
        key = portable_path_key(name)
        if key in planned:
            errors.append(f"duplicate archive member path: {archive_location}!/{name}")
            continue
        planned[key] = (name, is_directory)
    for key, (name, _is_directory) in planned.items():
        parts = PurePosixPath(key).parts
        for index in range(1, len(parts)):
            parent = PurePosixPath(*parts[:index]).as_posix()
            if parent in planned and not planned[parent][1]:
                errors.append(
                    "archive file/directory path collision: "
                    f"{archive_location}!/{planned[parent][0]} and {archive_location}!/{name}"
                )


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
            members = archive.infolist()
            validate_archive_member_plan(
                [(member.filename, member.is_dir()) for member in members],
                relative,
                errors,
            )
            for member in members:
                videos, captions = inspect_archive_member(
                    name=member.filename,
                    archive_location=relative,
                    stream_factory=lambda member=member: archive.open(member),
                    errors=errors,
                    warnings=warnings,
                    max_video_seconds=max_video_seconds,
                    is_directory=member.is_dir(),
                    is_link=stat.S_ISLNK(member.external_attr >> 16),
                    is_encrypted=bool(member.flag_bits & 0x1),
                )
                video_count += videos
                caption_count += captions
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError):
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
            members = archive.getmembers()
            validate_archive_member_plan(
                [(member.name, member.isdir()) for member in members], relative, errors
            )
            for member in members:
                videos, captions = inspect_archive_member(
                    name=member.name,
                    archive_location=relative,
                    stream_factory=lambda member=member: archive.extractfile(member),
                    errors=errors,
                    warnings=warnings,
                    max_video_seconds=max_video_seconds,
                    is_directory=member.isdir(),
                    is_link=member.issym() or member.islnk(),
                    is_regular=member.isfile(),
                )
                video_count += videos
                caption_count += captions
    except (tarfile.TarError, OSError):
        errors.append(f"unreadable tar archive: {relative}")
    return video_count, caption_count


def has_symlink_component(path: Path, root: Path) -> bool:
    current = root
    for part in path.relative_to(root).parts:
        current /= part
        if current.is_symlink():
            return True
    return False


def validate_manifest_files(root: Path, manifest: dict, errors: list[str]) -> set[str]:
    declared: set[str] = set()
    declared_casefold: set[str] = set()
    reserved = {portable_path_key(name) for name in RESERVED_OUTPUT_PATHS}
    artifacts = manifest.get("artifacts", [])
    if not isinstance(artifacts, list):
        errors.append("manifest artifacts must be a list")
        return declared
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            errors.append("manifest artifact must be an object")
            continue
        files = artifact.get("files", [])
        if not isinstance(files, list):
            errors.append("manifest artifact files must be a list")
            continue
        for entry in files:
            if not isinstance(entry, dict):
                errors.append("manifest file entry must be an object")
                continue
            raw_relative = entry.get("path")
            try:
                relative = portable_relative_path(raw_relative)
            except ValueError:
                errors.append(f"manifest path escapes output: {raw_relative}")
                continue
            key = portable_path_key(relative)
            if key in reserved:
                errors.append(
                    f"artifact declares reserved package metadata: {relative}"
                )
                continue
            if key in declared_casefold:
                errors.append(f"duplicate manifest path: {relative}")
                continue
            declared_casefold.add(key)
            declared.add(relative)
            path = root / relative
            if has_symlink_component(path, root):
                errors.append(f"symbolic link in declared path: {relative}")
            elif not path.is_file():
                errors.append(f"declared file is missing: {relative}")
            elif sha256(path) != entry.get("sha256"):
                errors.append(f"checksum mismatch: {relative}")
    return declared


def validate_submission(root: Path, max_video_seconds: float | None = None) -> dict:
    root = root.absolute()
    errors: list[str] = []
    warnings: list[str] = []
    if root.is_symlink():
        return {
            "valid": False,
            "errors": [f"submission root cannot be a symbolic link: {root}"],
            "warnings": [],
            "filesChecked": 0,
        }
    manifest_path = root / "manifest.json"
    if manifest_path.is_symlink():
        return {
            "valid": False,
            "errors": [f"manifest.json cannot be a symbolic link: {manifest_path}"],
            "warnings": [],
            "filesChecked": 0,
        }
    if not manifest_path.exists():
        raise ValueError("manifest.json is missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("manifest.json must contain an object")

    missing = manifest.get("missing", [])
    if not isinstance(missing, list):
        errors.append("manifest missing field must be a list")
    elif any(isinstance(item, dict) and item.get("required") for item in missing):
        errors.append("manifest contains missing required artifacts")
    requirements = manifest.get("requirements", [])
    if not isinstance(requirements, list):
        errors.append("manifest requirements must be a list")
    else:
        for requirement in requirements:
            if not isinstance(requirement, dict):
                errors.append("manifest requirement must be an object")
            elif requirement.get("required", True) and not requirement.get("covered"):
                errors.append(
                    f"required requirement is uncovered: {requirement.get('id')}"
                )

    declared = validate_manifest_files(root, manifest, errors)
    video_count = 0
    caption_count = 0
    actual_files = set()
    for path in root.rglob("*"):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            errors.append(f"symbolic link in package: {relative}")
            continue
        if not path.is_file():
            continue
        actual_files.add(relative)
        findings = path_policy_findings(relative)
        if "forbidden" in findings:
            errors.append(f"forbidden packaged path: {relative}")
        if "secret" in findings:
            errors.append(f"secret-like file path: {relative}")
        kind = archive_kind(path.name)
        if kind == "zip":
            videos, captions = inspect_zip(
                path, relative, errors, warnings, max_video_seconds
            )
            video_count += videos
            caption_count += captions
        elif kind == "tar":
            videos, captions = inspect_tar(
                path, relative, errors, warnings, max_video_seconds
            )
            video_count += videos
            caption_count += captions
        elif kind == "unsupported":
            errors.append(f"unsupported archive format: {relative}")
        suffix = path_suffix(path.name)
        if kind is None and suffix not in BINARY_SUFFIXES:
            with path.open("rb") as stream:
                scan_text_stream(stream, relative, errors, warnings)
        if suffix in VIDEO_SUFFIXES:
            video_count += 1
            probe_video(path, relative, max_video_seconds, errors)
        elif suffix == ".srt":
            if has_srt_cue(path):
                caption_count += 1
            else:
                errors.append(f"empty or malformed SRT captions: {relative}")

    if video_count and not caption_count:
        errors.append("video is present but no valid SRT caption file was packaged")

    generated = set(RESERVED_OUTPUT_PATHS)
    extras = sorted(actual_files - declared - generated)
    if extras:
        errors.append("undeclared files: " + ", ".join(extras))
    absent_generated = sorted(generated - actual_files)
    if absent_generated:
        errors.append("missing generated metadata: " + ", ".join(absent_generated))

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "filesChecked": len(declared | generated),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--max-video-seconds", type=float)
    args = parser.parse_args()
    try:
        result = validate_submission(args.output_dir, args.max_video_seconds)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
