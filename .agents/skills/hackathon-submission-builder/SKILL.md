---
name: hackathon-submission-builder
description: Build, collect, validate, and package complete hackathon submission deliverables into one specified directory, including submission copy, README and technical evidence, pitch materials, screenshots, compliance files, and a locally auto-recorded captioned demo video driven by deterministic fixtures and scenarios. Use when Codex is asked to prepare, finish, audit, bundle, or regenerate a hackathon submission (해커톤 제출물), especially when every required artifact must be gathered in one folder or a demo video must be recorded automatically.
---

# Hackathon Submission Builder

Produce a judge-ready submission directory, not merely advice or a checklist.

## Workflow

1. Resolve the project root and an explicit output directory. Default to `<project-root>/hackathon-submission` only when the user supplies no destination. Never write generated artifacts over source files.
2. Find the authoritative rules, form fields, judging criteria, deadlines, track requirements, video limits, repository/licensing rules, and disclosure requirements. Browse cited URLs when available. Record unknown requirements as blockers; do not invent facts.
3. Inspect the repository, docs, existing media, deployment information, git state, and test/build commands. Read [references/submission-playbook.md](references/submission-playbook.md) and create a requirement-to-artifact matrix before drafting.
4. Create missing deliverables in a separate work directory. Use evidence from the project. Mark unresolved values with `TODO-BLOCKED: <needed fact>` and surface them in the final report instead of fabricating metrics, URLs, team biographies, session IDs, or claims.
5. Plan the demo as claim → visible proof → action. Read [references/video-schema.md](references/video-schema.md), customize the supplied fixture and scenario templates, and use `scripts/record_demo.py` for deterministic browser recording and burned-in captions.
6. Create a package spec from `assets/submission-spec.example.json`. Run `scripts/package_submission.py` to preflight every source and destination, copy only declared artifacts through an atomic staging directory, and generate `manifest.json` plus `submission-status.md`. When generated artifacts live outside the project root, explicitly authorize their containing directory with repeatable `--work-dir /absolute/path`; sources outside the project root or those declared work directories are rejected. Do not use `manifest.json` or `submission-status.md` as deliverable destinations because the packager reserves them.
7. Run `scripts/validate_submission.py`. Fix every error that can be fixed locally. Re-run relevant project tests/builds and validation after changes.
8. Inspect the final directory itself. Report its absolute path, validation result, video duration, generated artifacts, and only genuinely unresolved blockers.

## Required output shape

Adapt names to the competition, but keep this separation:

```text
<output>/
  00-submit/       form-ready copy, links, track/category answers
  01-project/      README, setup guide, license, repository snapshot/link record
  02-technical/    architecture, implementation notes, AI/Codex disclosure
  03-media/        captioned demo, SRT, screenshots, thumbnails, pitch deck
  04-evidence/     tests, build logs, judging-criteria evidence
  05-compliance/   licenses, attributions, privacy/security disclosures
  manifest.json
  submission-status.md
```

Include only requested source snapshots; do not duplicate the entire repository by default. Never package `.env`, credentials, tokens, cookies, database dumps, private keys, `node_modules`, or unreviewed user data.

## Demo recording

Create project-specific fixtures that eliminate network and model nondeterminism while preserving the real UI behavior being demonstrated. Prefer route mocks and seeded app APIs over DOM manipulation. Make the demo visibly disclose mocked or seeded data when rules require it.

Run:

```bash
python3 <skill-directory>/scripts/record_demo.py \
  --base-url http://127.0.0.1:5173 \
  --start-command "npm run dev" \
  --scenario /absolute/path/demo-scenario.json \
  --fixtures /absolute/path/demo-fixtures.json \
  --output-dir /absolute/path/video-work \
  --voiceover macos-say
```

The recorder installs Playwright into an isolated cache when necessary, launches Chromium, applies fixtures before navigation, executes the scenario, records WebM, generates SRT from the actual step timeline, and creates a caption-burned MP4 with ffmpeg. On macOS, `--voiceover macos-say` also synthesizes each subtitle locally and aligns the audio with its recorded start time. Pass `--no-install` in offline environments with Playwright already available via `--playwright-root`.

Do not claim the video is complete until the command succeeds, `ffprobe` reads the MP4, its duration meets the competition limit, captions are visible in sampled frames, and the scenario's critical assertions pass. Keep the SRT beside the MP4 even though captions are burned in.

## Completion gate

Require all of the following:

- Every authoritative requirement maps to a final artifact or an explicit blocker.
- Form copy and pitch claims match repository evidence and the visible demo.
- Setup instructions were executed or clearly identify what could not be executed.
- Public URLs were checked when network access is available.
- The demo has no secrets, notifications, personal data, loading failures, dead time, or hidden critical steps.
- The package validator reports zero errors.
- A human can submit using only the final directory and the recorded blocker list.

If credentials, private URLs, team facts, a deployment, or an external upload are missing, finish every local artifact and stop at a clear handoff. Do not publish, submit forms, push repositories, or upload videos without explicit authorization.
