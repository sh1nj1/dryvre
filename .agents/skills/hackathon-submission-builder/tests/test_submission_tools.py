from __future__ import annotations

import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import package_submission as packager  # noqa: E402
import submission_policy as policy  # noqa: E402
import validate_submission as validator  # noqa: E402


class PolicyTests(unittest.TestCase):
    def test_portable_path_matrix(self):
        unsafe = [
            "/etc/passwd",
            "../escape",
            "nested/../../escape",
            r"C:\Users\me\proof.txt",
            "D:relative.txt",
            r"\\server\share\proof.txt",
            "folder/file.txt.",
            "folder/name:stream",
            "CON.txt",
        ]
        for value in unsafe:
            with self.subTest(value=value):
                self.assertTrue(policy.unsafe_archive_member_path(value))
        for value in ["media/demo.mp4", "folder/C_notes.txt", "nested/file.txt"]:
            with self.subTest(value=value):
                self.assertFalse(policy.unsafe_archive_member_path(value))

    def test_path_policy_matrix(self):
        blocked = [
            "node_modules/pkg/index.js",
            ".git/config",
            ".env",
            "keys/prod.pfx",
            "data/prod.sqlite-wal",
            ".npmrc",
        ]
        for value in blocked:
            with self.subTest(value=value):
                self.assertTrue(policy.path_policy_findings(value))
        for value in [".env.example", "pitch.key", "docs/schema.sql"]:
            with self.subTest(value=value):
                self.assertFalse(policy.path_policy_findings(value))

    def test_stream_scanner_covers_encodings_and_credentials(self):
        fixtures = [
            b"prefix\xffOPENAI_API_KEY=abcdefghijklmnop",
            b'{"OPENAI_API_KEY":"sk-abcdefghijklmnop"}',
            b"'STRIPE_SECRET_KEY': 'sk_live_abcdefghijklmnop'",
            "client_secret=abcdefghijklmnop".encode("utf-16-le"),
            b"DATABASE_URL=postgres://user:pass@localhost/db",
            b"SLACK_BOT_TOKEN=xoxb-12345678",
        ]
        for content in fixtures:
            with self.subTest(content=content[:24]):
                errors: list[str] = []
                policy.scan_text_stream(io.BytesIO(content), "fixture", errors, [])
                self.assertTrue(errors)

    def test_quoted_provider_placeholders_are_not_overmatched(self):
        errors: list[str] = []
        policy.scan_text_stream(
            io.BytesIO(b'{"OPENAI_API_KEY":"replace-me"}'),
            "fixture",
            errors,
            [],
        )
        self.assertEqual(errors, [])


class PackagerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.project = self.root / "project"
        self.project.mkdir()
        self.spec = self.project / "spec.json"

    def tearDown(self):
        self.temporary.cleanup()

    def write_spec(
        self, deliverables: list[dict], requirements: list[dict] | None = None
    ):
        self.spec.write_text(
            json.dumps(
                {
                    "project": "Fixture",
                    "requirements": requirements or [],
                    "deliverables": deliverables,
                }
            ),
            encoding="utf-8",
        )

    def test_external_work_artifact_preserves_provenance(self):
        work = self.root / "video-work"
        work.mkdir()
        artifact = work / "demo.srt"
        artifact.write_text(
            "1\n00:00:00,000 --> 00:00:01,000\nDemo\n", encoding="utf-8"
        )
        self.write_spec(
            [
                {
                    "id": "captions",
                    "source": str(artifact),
                    "destination": "03-media/demo.srt",
                }
            ]
        )
        output = self.root / "submission"
        result = packager.build_submission(self.spec, self.project, [work], output)
        self.assertEqual(result["errors"], 0)
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["artifacts"][0]["origin"], "work-dir[1]")
        self.assertEqual(manifest["artifacts"][0]["source"], "work-dir[1]/demo.srt")
        self.assertNotIn(str(self.root), (output / "manifest.json").read_text())
        self.assertTrue(validator.validate_submission(output)["valid"])

    def test_forbidden_work_root_is_rejected_before_rebasing(self):
        work = self.project / "node_modules" / "pkg"
        work.mkdir(parents=True)
        artifact = work / "index.js"
        artifact.write_text("export default 1", encoding="utf-8")
        self.write_spec(
            [
                {
                    "id": "dependency",
                    "source": str(artifact),
                    "destination": "00-submit/index.js",
                }
            ]
        )
        output = self.root / "submission"
        with self.assertRaisesRegex(ValueError, "forbidden work directory"):
            packager.build_submission(self.spec, self.project, [work], output)
        self.assertFalse(output.exists())

    def test_reserved_metadata_destinations_are_rejected_preflight(self):
        source = self.project / "proof.txt"
        source.write_text("proof", encoding="utf-8")
        cases = []
        cases.append(
            [
                {
                    "id": "direct",
                    "source": "proof.txt",
                    "destination": "manifest.json",
                }
            ]
        )
        nested_metadata = self.project / "nested-metadata"
        nested_metadata.mkdir()
        (nested_metadata / "child.txt").write_text("shadow", encoding="utf-8")
        cases.append(
            [
                {
                    "id": "metadata-directory",
                    "source": "nested-metadata",
                    "destination": "manifest.json",
                }
            ]
        )
        directory = self.project / "bundle"
        directory.mkdir()
        (directory / "submission-status.md").write_text("shadow", encoding="utf-8")
        cases.append(
            [
                {
                    "id": "nested",
                    "source": "bundle",
                    "destination": ".",
                }
            ]
        )
        for index, deliverables in enumerate(cases):
            with self.subTest(case=index):
                self.write_spec(deliverables)
                output = self.root / f"submission-{index}"
                with self.assertRaisesRegex(ValueError, "reserved package metadata"):
                    packager.build_submission(self.spec, self.project, [], output)
                self.assertFalse(output.exists())

    def test_destination_collisions_are_rejected_preflight(self):
        (self.project / "one.txt").write_text("one")
        (self.project / "two.txt").write_text("two")
        self.write_spec(
            [
                {"id": "one", "source": "one.txt", "destination": "Proof.txt"},
                {"id": "two", "source": "two.txt", "destination": "proof.TXT"},
            ]
        )
        with self.assertRaisesRegex(ValueError, "same path"):
            packager.build_submission(
                self.spec, self.project, [], self.root / "submission"
            )

    def test_quoted_provider_key_fails_end_to_end_validation(self):
        source = self.project / "configuration.json"
        source.write_text(
            json.dumps({"OPENAI_API_KEY": "sk-abcdefghijklmnop"}),
            encoding="utf-8",
        )
        self.write_spec(
            [
                {
                    "id": "configuration",
                    "source": "configuration.json",
                    "destination": "02-technical/configuration.json",
                }
            ]
        )
        output = self.root / "submission"
        packager.build_submission(self.spec, self.project, [], output)
        result = validator.validate_submission(output)
        self.assertFalse(result["valid"])
        self.assertTrue(
            any("possible credential" in error for error in result["errors"])
        )


class ValidatorTests(unittest.TestCase):
    def test_validator_rejects_manifest_symlink_before_reading(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "submission"
            root.mkdir()
            outside = Path(temporary) / "outside.json"
            outside.write_text("not a submission manifest", encoding="utf-8")
            (root / "manifest.json").symlink_to(outside)

            result = validator.validate_submission(root)

            self.assertFalse(result["valid"])
            self.assertEqual(result["filesChecked"], 0)
            self.assertTrue(
                any(
                    "manifest.json cannot be a symbolic link" in error
                    for error in result["errors"]
                )
            )

    def test_zip_and_tar_share_member_path_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            names = (
                r"C:\Users\me\proof.txt",
                "D:relative.txt",
                r"\\server\share\proof.txt",
                "node_modules/pkg/index.js",
            )
            zip_path = root / "unsafe.zip"
            with zipfile.ZipFile(zip_path, "w") as archive:
                for name in names:
                    archive.writestr(name, "proof")
            zip_errors: list[str] = []
            validator.inspect_zip(zip_path, zip_path.name, zip_errors, [])
            self.assertEqual(
                sum("unsafe archive member path" in error for error in zip_errors), 3
            )
            self.assertTrue(
                any("forbidden archived path" in error for error in zip_errors)
            )

            tar_path = root / "unsafe.tar"
            with tarfile.open(tar_path, "w") as archive:
                for name in names:
                    info = tarfile.TarInfo(name)
                    info.size = 5
                    archive.addfile(info, io.BytesIO(b"proof"))
            tar_errors: list[str] = []
            validator.inspect_tar(tar_path, tar_path.name, tar_errors, [])
            self.assertEqual(
                sum("unsafe archive member path" in error for error in tar_errors), 3
            )
            self.assertTrue(
                any("forbidden archived path" in error for error in tar_errors)
            )

    def test_archive_duplicate_names_are_rejected_portably(self):
        errors: list[str] = []
        validator.validate_archive_member_plan(
            [("Proof.txt", False), ("proof.TXT", False)], "fixture.zip", errors
        )
        self.assertTrue(any("duplicate archive member" in error for error in errors))

    @mock.patch.object(validator.shutil, "which", return_value=None)
    def test_video_probe_fails_closed_without_ffprobe(self, _which):
        errors: list[str] = []
        validator.probe_video(Path("demo.mp4"), "demo.mp4", None, errors)
        self.assertEqual(errors, ["cannot inspect video without ffprobe: demo.mp4"])

    @mock.patch.object(validator.shutil, "which", return_value="/usr/bin/ffprobe")
    @mock.patch.object(validator.subprocess, "run")
    def test_video_probe_requires_video_stream(self, run, _which):
        run.return_value = subprocess.CompletedProcess(
            [],
            0,
            json.dumps(
                {"format": {"duration": "1.0"}, "streams": [{"codec_type": "audio"}]}
            ),
            "",
        )
        errors: list[str] = []
        validator.probe_video(Path("audio.mp4"), "audio.mp4", None, errors)
        self.assertEqual(errors, ["no video stream: audio.mp4"])

    def test_validator_rejects_artifact_claiming_generated_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "submission-status.md").write_text("status")
            manifest = {
                "artifacts": [
                    {"files": [{"path": "manifest.json", "sha256": "not-relevant"}]}
                ],
                "missing": [],
                "requirements": [],
            }
            (root / "manifest.json").write_text(json.dumps(manifest))
            result = validator.validate_submission(root)
            self.assertFalse(result["valid"])
            self.assertTrue(
                any("reserved package metadata" in error for error in result["errors"])
            )


if __name__ == "__main__":
    unittest.main()
