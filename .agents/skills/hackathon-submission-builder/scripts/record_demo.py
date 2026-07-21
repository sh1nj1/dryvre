#!/usr/bin/env python3
"""Start a local app, record a fixture-driven scenario, and burn timed captions."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PLAYWRIGHT_VERSION = "1.54.2"


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    print("+", " ".join(shlex.quote(part) for part in command), flush=True)
    return subprocess.run(command, check=True, **kwargs)


def find_local_playwright(start: Path) -> Path | None:
    for directory in [start.resolve(), *start.resolve().parents]:
        candidate = directory / "node_modules" / "playwright"
        if (candidate / "index.mjs").exists():
            return candidate
    return None


def ensure_playwright(project_root: Path, explicit: Path | None, no_install: bool) -> tuple[Path, dict[str, str]]:
    if explicit:
        package_root = explicit.resolve()
    else:
        package_root = find_local_playwright(project_root)
    environment = os.environ.copy()
    if package_root and (package_root / "index.mjs").exists():
        if not no_install:
            run(["node", str(package_root / "cli.js"), "install", "chromium"], env=environment)
        return package_root, environment
    if no_install:
        raise RuntimeError("Playwright was not found; remove --no-install or pass --playwright-root")
    cache_root = Path(tempfile.gettempdir()) / "hackathon-submission-video-tools" / f"playwright-{PLAYWRIGHT_VERSION}"
    package_root = cache_root / "node_modules" / "playwright"
    if not (package_root / "index.mjs").exists():
        cache_root.mkdir(parents=True, exist_ok=True)
        run(["npm", "install", "--prefix", str(cache_root), "--no-save", f"playwright@{PLAYWRIGHT_VERSION}"])
    browsers_root = cache_root / "browsers"
    environment["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_root)
    run(["node", str(package_root / "cli.js"), "install", "chromium"], env=environment)
    return package_root, environment


def wait_until_ready(url: str, timeout: float, process: subprocess.Popen | None) -> None:
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        if process and process.poll() is not None:
            raise RuntimeError(f"start command exited with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception as error:  # readiness errors are expected while booting
            last_error = str(error)
        time.sleep(0.5)
    raise RuntimeError(f"app did not become ready at {url}: {last_error}")


def timestamp(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"


def write_srt(timeline_path: Path, srt_path: Path) -> int:
    data = json.loads(timeline_path.read_text(encoding="utf-8"))
    captions = [entry for entry in data["timeline"] if entry.get("subtitle")]
    blocks = []
    for index, entry in enumerate(captions, 1):
        start = int(entry["startMs"])
        end = max(int(entry["endMs"]), start + 1_200)
        text = str(entry["subtitle"]).replace("\r", "").strip()
        blocks.append(f"{index}\n{timestamp(start)} --> {timestamp(end)}\n{text}\n")
    srt_path.write_text("\n".join(blocks), encoding="utf-8")
    return len(captions)


def prepare_output_directory(output: Path, project_root: Path) -> None:
    if output == project_root:
        raise RuntimeError("output directory cannot be the project root")
    if output.exists():
        if not output.is_dir():
            raise RuntimeError(f"output path is not a directory: {output}")
        if any(output.iterdir()):
            raise RuntimeError(f"output directory must be new or empty: {output}")
    else:
        output.mkdir(parents=True)


def add_macos_voiceover(silent_video: Path, timeline_path: Path, final_video: Path, voice: str, rate: int) -> int:
    if not shutil.which("say"):
        raise RuntimeError("macOS `say` was not found; use --voiceover none and provide audio separately")
    data = json.loads(timeline_path.read_text(encoding="utf-8"))
    captions = [entry for entry in data["timeline"] if entry.get("subtitle")]
    voice_dir = silent_video.parent / "voiceover"
    voice_dir.mkdir(exist_ok=True)
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []
    for index, entry in enumerate(captions, 1):
        audio_path = voice_dir / f"segment-{index:02}.aiff"
        run(["say", "-v", voice, "-r", str(rate), "-o", str(audio_path), str(entry["subtitle"])])
        inputs += ["-i", str(audio_path)]
        label = f"voice{index}"
        delay = max(0, int(entry["startMs"]))
        filters.append(f"[{index}:a]adelay={delay}:all=1[{label}]")
        labels.append(f"[{label}]")
    if not captions:
        raise RuntimeError("cannot synthesize voiceover without subtitle entries")
    filters.append(
        f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=0,apad[aout]"
    )
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", str(silent_video),
        *inputs, "-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", str(final_video),
    ])
    return len(captions)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--scenario", required=True, type=Path)
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--start-command")
    parser.add_argument("--ready-url")
    parser.add_argument("--ready-timeout", type=float, default=90)
    parser.add_argument("--playwright-root", type=Path)
    parser.add_argument("--no-install", action="store_true")
    parser.add_argument("--keep-raw", action="store_true")
    parser.add_argument("--voiceover", choices=("none", "macos-say"), default="none")
    parser.add_argument("--voice", default="Samantha")
    parser.add_argument("--speech-rate", type=int, default=185)
    args = parser.parse_args()

    for executable in ("node", "ffmpeg", "ffprobe"):
        if not shutil.which(executable):
            raise RuntimeError(f"required executable not found: {executable}")
    scenario = args.scenario.resolve()
    fixtures = args.fixtures.resolve() if args.fixtures else None
    output = args.output_dir.resolve()
    project_root = args.project_root.resolve()
    prepare_output_directory(output, project_root)
    playwright_root, environment = ensure_playwright(project_root, args.playwright_root, args.no_install)

    server = None
    server_log = None
    try:
        if args.start_command:
            server_log = (output / "app-server.log").open("w", encoding="utf-8")
            server = subprocess.Popen(
                shlex.split(args.start_command), cwd=project_root, stdout=server_log,
                stderr=subprocess.STDOUT, start_new_session=True, text=True,
            )
        wait_until_ready(args.ready_url or args.base_url, args.ready_timeout, server)
        node_script = Path(__file__).with_name("record_demo.mjs")
        run([
            "node", str(node_script), str(playwright_root), args.base_url, str(scenario),
            str(fixtures) if fixtures else "", str(output),
        ], cwd=project_root, env=environment)

        captions = output / "demo.srt"
        caption_count = write_srt(output / "timeline.json", captions)
        if caption_count == 0:
            raise RuntimeError("scenario produced no captions; add subtitle fields")
        final_video = output / "demo-captioned.mp4"
        rendered_video = output / ("demo-captioned-silent.mp4" if args.voiceover != "none" else final_video.name)
        subtitle_filter = "subtitles=demo.srt:force_style='FontName=Sans,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=28'"
        run([
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", "demo-raw.webm", "-vf", subtitle_filter,
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", rendered_video.name,
        ], cwd=output)
        if args.voiceover == "macos-say":
            add_macos_voiceover(rendered_video, output / "timeline.json", final_video, args.voice, args.speech_rate)
            rendered_video.unlink(missing_ok=True)
        probe = run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(final_video),
        ], capture_output=True, text=True)
        duration = float(probe.stdout.strip())
        if duration <= 0:
            raise RuntimeError("ffprobe reported an empty video")
        if not args.keep_raw:
            (output / "demo-raw.webm").unlink(missing_ok=True)
            shutil.rmtree(output / "raw", ignore_errors=True)
        print(json.dumps({"video": str(final_video), "captions": str(captions), "durationSeconds": round(duration, 3)}))
        return 0
    finally:
        if server and server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
        if server_log:
            server_log.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
