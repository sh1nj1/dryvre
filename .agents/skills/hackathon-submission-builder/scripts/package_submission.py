#!/usr/bin/env python3
"""Copy declared hackathon artifacts into a deterministic submission directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

FORBIDDEN_SOURCE_PATH = re.compile(
    r"(^|/)(node_modules(/|$)|\.env($|\.)|id_rsa|id_ed25519|.*\.(pem|p12)|"
    r"(?:private|secret|server|client|tls|ssl)[^/]*\.key$|"
    r"cookies?\.json$|\.npmrc$|\.yarnrc(?:\.yml)?$|\.pypirc$|\.netrc$|pip\.conf$|"
    r"auth\.toml$|credentials\.toml$|[^/]+\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$|"
    r"[^/]*(?:dump|backup)[^/]*\.sql$)",
    re.I,
)


def fail(message: str) -> None:
    raise ValueError(message)


def inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def safe_destination(root: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute():
        fail(f"destination must be a relative path: {relative!r}")
    destination = (root / relative).resolve()
    if not inside(destination, root):
        fail(f"destination escapes output directory: {relative}")
    return destination


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reject_forbidden_sources(source: Path, project_root: Path) -> None:
    candidates = [source]
    if source.is_dir():
        candidates.extend(source.rglob("*"))
    for candidate in candidates:
        relative = candidate.relative_to(project_root).as_posix()
        if FORBIDDEN_SOURCE_PATH.search(relative):
            fail(f"forbidden source path: {relative}")


def copy_file(source: Path, destination: Path, output_root: Path) -> dict:
    if source.is_symlink():
        fail(f"symbolic links are not packaged: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        fail(f"two deliverables target the same path: {destination}")
    shutil.copy2(source, destination)
    return {
        "path": destination.relative_to(output_root).as_posix(),
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
    }


def copy_declared(source: Path, destination: Path, output_root: Path) -> list[dict]:
    if source.is_file():
        return [copy_file(source, destination, output_root)]
    if not source.is_dir():
        fail(f"source is neither a file nor directory: {source}")
    if source.is_symlink():
        fail(f"symbolic links are not packaged: {source}")
    copied: list[dict] = []
    for child in sorted(source.rglob("*")):
        if child.is_symlink():
            fail(f"symbolic links are not packaged: {child}")
        if child.is_file():
            copied.append(copy_file(child, destination / child.relative_to(source), output_root))
    if not copied:
        fail(f"source directory contains no files: {source}")
    return copied


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    project_root = args.project_root.resolve()
    output_root = args.output_dir.resolve()
    spec_path = args.spec.resolve()
    if not inside(spec_path, project_root):
        fail("package spec must be inside the project root")
    if inside(output_root, project_root) and output_root == project_root:
        fail("output directory cannot be the project root")
    if output_root.exists() and any(output_root.iterdir()):
        fail(f"output directory must be new or empty: {output_root}")
    output_root.mkdir(parents=True, exist_ok=True)

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    deliverables = spec.get("deliverables")
    requirements = spec.get("requirements", [])
    if not isinstance(deliverables, list) or not deliverables:
        fail("spec.deliverables must be a non-empty list")

    artifacts = []
    missing = []
    ids = set()
    for item in deliverables:
        artifact_id = item.get("id")
        if not artifact_id or artifact_id in ids:
            fail(f"deliverable id is missing or duplicated: {artifact_id!r}")
        ids.add(artifact_id)
        source_value = item.get("source")
        destination_value = item.get("destination")
        if not source_value or not destination_value:
            fail(f"deliverable {artifact_id} needs source and destination")
        source = (project_root / source_value).resolve()
        if not inside(source, project_root):
            fail(f"source escapes project root: {source_value}")
        required = bool(item.get("required", True))
        if not source.exists():
            missing.append({"id": artifact_id, "source": source_value, "required": required})
            continue
        reject_forbidden_sources(source, project_root)
        if source.is_dir() and inside(output_root, source):
            fail(f"output directory cannot be nested inside a packaged source directory: {source_value}")
        destination = safe_destination(output_root, destination_value)
        files = copy_declared(source, destination, output_root)
        artifacts.append(
            {
                "id": artifact_id,
                "source": source.relative_to(project_root).as_posix(),
                "destination": destination_value,
                "required": required,
                "requirements": item.get("requirements", []),
                "files": files,
            }
        )

    covered = {req for artifact in artifacts for req in artifact["requirements"]}
    requirement_status = []
    for requirement in requirements:
        requirement_status.append(
            {
                **requirement,
                "covered": requirement.get("id") in covered,
            }
        )

    manifest = {
        "schemaVersion": 1,
        "project": spec.get("project", project_root.name),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "artifacts": artifacts,
        "missing": missing,
        "requirements": requirement_status,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    required_missing = [entry for entry in missing if entry["required"]]
    uncovered = [entry for entry in requirement_status if entry.get("required", True) and not entry["covered"]]
    lines = [
        f"# Submission status: {manifest['project']}",
        "",
        f"- Packaged artifacts: {len(artifacts)}",
        f"- Missing required artifacts: {len(required_missing)}",
        f"- Uncovered required requirements: {len(uncovered)}",
        "",
    ]
    if required_missing:
        lines += ["## Missing required artifacts", ""] + [
            f"- `{item['id']}` from `{item['source']}`" for item in required_missing
        ] + [""]
    if uncovered:
        lines += ["## Uncovered required requirements", ""] + [
            f"- `{item.get('id', 'unknown')}`: {item.get('text', '')}" for item in uncovered
        ] + [""]
    lines += ["Run `validate_submission.py` before handoff.", ""]
    (output_root / "submission-status.md").write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps({"output": str(output_root), "artifacts": len(artifacts), "errors": len(required_missing) + len(uncovered)}))
    return 1 if required_missing or uncovered else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
