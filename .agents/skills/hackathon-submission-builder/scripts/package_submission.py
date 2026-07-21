#!/usr/bin/env python3
"""Preflight and atomically package declared hackathon artifacts."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from submission_policy import (
    RESERVED_OUTPUT_PATHS,
    VCS_DIRECTORIES,
    path_policy_findings,
    portable_path_key,
    portable_relative_path,
    sha256,
)


def fail(message: str) -> None:
    raise ValueError(message)


def inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


@dataclass(frozen=True)
class SourceRef:
    path: Path
    root: Path
    label: str
    origin: str


@dataclass(frozen=True)
class PlannedFile:
    source: Path
    destination: str


@dataclass(frozen=True)
class PlannedArtifact:
    artifact_id: str
    source: SourceRef
    destination: str
    required: bool
    requirements: tuple[str, ...]
    files: tuple[PlannedFile, ...]


def walk_source_entries(source: Path):
    yield source
    if not source.is_dir():
        return
    for directory, directory_names, file_names in os.walk(
        source, topdown=True, followlinks=False
    ):
        directory_names.sort()
        file_names.sort()
        kept_directories = []
        for name in directory_names:
            child = Path(directory) / name
            if name.lower() in VCS_DIRECTORIES and not child.is_symlink():
                continue
            kept_directories.append(name)
            yield child
        directory_names[:] = kept_directories
        for name in file_names:
            yield Path(directory) / name


def containing_source_root(source: Path, allowed_roots: list[Path]) -> Path | None:
    matches = [root for root in allowed_roots if inside(source, root)]
    return max(matches, key=lambda root: len(root.parts), default=None)


def source_label(
    source: Path, source_root: Path, project_root: Path, work_roots: list[Path]
) -> str:
    relative = source.relative_to(source_root).as_posix()
    if source_root == project_root:
        return relative
    return f"work-dir[{work_roots.index(source_root) + 1}]/{relative}"


def reject_policy_path(value: str, message: str) -> None:
    if path_policy_findings(value):
        fail(f"{message}: {value}")


def resolve_source(
    source_value: str,
    project_root: Path,
    work_roots: list[Path],
) -> SourceRef:
    if not isinstance(source_value, str) or not source_value:
        fail(f"source must be a non-empty string: {source_value!r}")
    declared = Path(source_value)
    lexical = declared if declared.is_absolute() else project_root / declared
    if lexical.is_symlink():
        fail(f"symbolic links are not packaged: {source_value}")
    source = lexical.resolve()
    allowed_roots = [project_root, *work_roots]
    source_root = containing_source_root(source, allowed_roots)
    if source_root is None:
        fail(
            "source is outside the project root and declared work directories: "
            f"{source_value}"
        )

    if source_root == project_root:
        policy_path = source.relative_to(project_root).as_posix()
        origin = "project"
    else:
        # Preserve the full provenance before rebasing to a trusted work root.
        reject_policy_path(source_root.as_posix(), "forbidden work directory")
        policy_path = source.as_posix()
        origin = f"work-dir[{work_roots.index(source_root) + 1}]"
    reject_policy_path(policy_path, "forbidden source path")
    return SourceRef(
        path=source,
        root=source_root,
        label=source_label(source, source_root, project_root, work_roots),
        origin=origin,
    )


def source_files(source: SourceRef) -> list[tuple[Path, Path]]:
    if not source.path.exists():
        return []
    if not source.path.is_file() and not source.path.is_dir():
        fail(f"source is neither a file nor directory: {source.path}")
    if source.path.is_file():
        entries = [(source.path, Path("."))]
    else:
        entries = []
        for candidate in walk_source_entries(source.path):
            if candidate == source.path:
                continue
            if candidate.is_symlink():
                fail(f"symbolic links are not packaged: {candidate}")
            relative_to_root = candidate.relative_to(source.root).as_posix()
            reject_policy_path(relative_to_root, "forbidden source path")
            if candidate.is_file():
                entries.append((candidate, candidate.relative_to(source.path)))
        if not entries:
            fail(f"source directory contains no files: {source.path}")
    return entries


def destination_for_file(
    destination_value: str, child_relative: Path, source_is_directory: bool
) -> str:
    destination = portable_relative_path(
        destination_value, allow_current=source_is_directory
    )
    if source_is_directory:
        child = PurePosixPath(child_relative.as_posix())
        target = child if destination == "." else PurePosixPath(destination) / child
    else:
        target = PurePosixPath(destination)
    return portable_relative_path(target.as_posix())


def validate_destination_plan(files: list[PlannedFile]) -> None:
    reserved = {portable_path_key(path) for path in RESERVED_OUTPUT_PATHS}
    targets: dict[str, str] = {}
    for planned in files:
        target_key = portable_path_key(planned.destination)
        if any(
            target_key == reserved_key or target_key.startswith(f"{reserved_key}/")
            for reserved_key in reserved
        ):
            fail(
                f"deliverable targets reserved package metadata: {planned.destination}"
            )
        if target_key in targets:
            fail(
                "two deliverables target the same path: "
                f"{targets[target_key]} and {planned.destination}"
            )
        targets[target_key] = planned.destination

    for key, destination in targets.items():
        parts = PurePosixPath(key).parts
        for index in range(1, len(parts)):
            parent = PurePosixPath(*parts[:index]).as_posix()
            if parent in targets:
                fail(
                    "file/directory destination collision: "
                    f"{targets[parent]} and {destination}"
                )


def preflight(
    spec: dict,
    project_root: Path,
    work_roots: list[Path],
    output_root: Path,
) -> tuple[list[PlannedArtifact], list[dict]]:
    deliverables = spec.get("deliverables")
    if not isinstance(deliverables, list) or not deliverables:
        fail("spec.deliverables must be a non-empty list")

    artifacts = []
    missing = []
    all_files: list[PlannedFile] = []
    ids = set()
    for item in deliverables:
        if not isinstance(item, dict):
            fail("every deliverable must be an object")
        artifact_id = item.get("id")
        if not isinstance(artifact_id, str) or not artifact_id or artifact_id in ids:
            fail(f"deliverable id is missing or duplicated: {artifact_id!r}")
        ids.add(artifact_id)
        source_value = item.get("source")
        destination_value = item.get("destination")
        if not source_value or not destination_value:
            fail(f"deliverable {artifact_id} needs source and destination")
        source = resolve_source(source_value, project_root, work_roots)
        required = bool(item.get("required", True))
        if not source.path.exists():
            missing.append(
                {"id": artifact_id, "source": source.label, "required": required}
            )
            continue
        if source.path.is_dir() and inside(output_root, source.path):
            fail(
                "output directory cannot be nested inside a packaged source directory: "
                f"{source_value}"
            )
        files = tuple(
            PlannedFile(
                source=path,
                destination=destination_for_file(
                    destination_value, relative, source.path.is_dir()
                ),
            )
            for path, relative in source_files(source)
        )
        all_files.extend(files)
        requirements = item.get("requirements", [])
        if not isinstance(requirements, list) or not all(
            isinstance(value, str) for value in requirements
        ):
            fail(f"deliverable {artifact_id} requirements must be a list of strings")
        artifacts.append(
            PlannedArtifact(
                artifact_id=artifact_id,
                source=source,
                destination=destination_value,
                required=required,
                requirements=tuple(requirements),
                files=files,
            )
        )
    validate_destination_plan(all_files)
    return artifacts, missing


def copy_planned_file(planned: PlannedFile, stage_root: Path) -> dict:
    destination = stage_root / PurePosixPath(planned.destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(planned.source, destination)
    return {
        "path": planned.destination,
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
    }


def write_metadata(
    stage_root: Path,
    spec: dict,
    project_root: Path,
    planned_artifacts: list[PlannedArtifact],
    missing: list[dict],
) -> tuple[dict, int]:
    artifacts = []
    for planned in planned_artifacts:
        artifacts.append(
            {
                "id": planned.artifact_id,
                "source": planned.source.label,
                "origin": planned.source.origin,
                "destination": planned.destination,
                "required": planned.required,
                "requirements": list(planned.requirements),
                "files": [
                    copy_planned_file(item, stage_root) for item in planned.files
                ],
            }
        )

    requirements = spec.get("requirements", [])
    if not isinstance(requirements, list) or not all(
        isinstance(item, dict) for item in requirements
    ):
        fail("spec.requirements must be a list of objects")
    covered = {req for artifact in artifacts for req in artifact["requirements"]}
    requirement_status = [
        {**requirement, "covered": requirement.get("id") in covered}
        for requirement in requirements
    ]
    manifest = {
        "schemaVersion": 1,
        "project": spec.get("project", project_root.name),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "artifacts": artifacts,
        "missing": missing,
        "requirements": requirement_status,
    }
    (stage_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    required_missing = [entry for entry in missing if entry["required"]]
    uncovered = [
        entry
        for entry in requirement_status
        if entry.get("required", True) and not entry["covered"]
    ]
    lines = [
        f"# Submission status: {manifest['project']}",
        "",
        f"- Packaged artifacts: {len(artifacts)}",
        f"- Missing required artifacts: {len(required_missing)}",
        f"- Uncovered required requirements: {len(uncovered)}",
        "",
    ]
    if required_missing:
        lines += (
            ["## Missing required artifacts", ""]
            + [f"- `{item['id']}` from `{item['source']}`" for item in required_missing]
            + [""]
        )
    if uncovered:
        lines += (
            ["## Uncovered required requirements", ""]
            + [
                f"- `{item.get('id', 'unknown')}`: {item.get('text', '')}"
                for item in uncovered
            ]
            + [""]
        )
    lines += ["Run `validate_submission.py` before handoff.", ""]
    (stage_root / "submission-status.md").write_text("\n".join(lines), encoding="utf-8")
    return manifest, len(required_missing) + len(uncovered)


def publish_stage(stage_root: Path, output_root: Path) -> None:
    if output_root.exists():
        if output_root.is_symlink() or not output_root.is_dir():
            fail(f"output path must be a directory: {output_root}")
        if any(output_root.iterdir()):
            fail(f"output directory must be new or empty: {output_root}")
        output_root.rmdir()
    stage_root.replace(output_root)


def build_submission(
    spec_path: Path,
    project_root: Path,
    work_roots: list[Path],
    output_root: Path,
) -> dict:
    project_root = project_root.resolve()
    work_roots = [path.resolve() for path in work_roots]
    output_root = output_root.absolute()
    spec_path = spec_path.resolve()
    if not inside(spec_path, project_root):
        fail("package spec must be inside the project root")
    for work_root in work_roots:
        if not work_root.is_dir():
            fail(f"work directory does not exist or is not a directory: {work_root}")
        if work_root == Path(work_root.anchor):
            fail("filesystem root cannot be used as a work directory")
        reject_policy_path(work_root.as_posix(), "forbidden work directory")
    if output_root.resolve() == project_root:
        fail("output directory cannot be the project root")
    if output_root.is_symlink():
        fail(f"output directory cannot be a symbolic link: {output_root}")
    if output_root.exists() and (
        not output_root.is_dir() or any(output_root.iterdir())
    ):
        fail(f"output directory must be new or empty: {output_root}")

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    if not isinstance(spec, dict):
        fail("package spec must be an object")
    planned_artifacts, missing = preflight(
        spec, project_root, work_roots, output_root.resolve()
    )

    output_root.parent.mkdir(parents=True, exist_ok=True)
    stage_root = Path(
        tempfile.mkdtemp(prefix=f".{output_root.name}.stage-", dir=output_root.parent)
    )
    published = False
    try:
        manifest, error_count = write_metadata(
            stage_root, spec, project_root, planned_artifacts, missing
        )
        publish_stage(stage_root, output_root)
        published = True
    finally:
        if not published:
            shutil.rmtree(stage_root, ignore_errors=True)
    return {
        "output": str(output_root),
        "artifacts": len(manifest["artifacts"]),
        "errors": error_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--work-dir",
        action="append",
        default=[],
        type=Path,
        help="additional trusted root containing generated artifacts (repeatable)",
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    result = build_submission(
        args.spec, args.project_root, args.work_dir, args.output_dir
    )
    print(json.dumps(result))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
