# Video fixtures and scenario schema

## Fixture file

Use JSON with any of these fields:

```json
{
  "localStorage": {"demoMode": "true"},
  "sessionStorage": {},
  "cookies": [{"name": "demo", "value": "1", "url": "http://127.0.0.1:5173"}],
  "routes": [
    {
      "url": "**/api/items",
      "method": "GET",
      "status": 200,
      "contentType": "application/json",
      "json": [{"id": "demo-1", "title": "Seeded item"}]
    }
  ]
}
```

Routes are registered in file order. A route may use `json`, string `body`, or absolute/fixture-relative `bodyFile`. Add `headers` when needed. A method is optional and matches every method when omitted.

## Scenario file

Top-level fields:

- `name`: human-readable demo name
- `startPath`: initial URL path, default `/`
- `viewport`: `{ "width": 1440, "height": 900 }`
- `defaultPauseMs`: pause after actions, default `350`
- `steps`: ordered actions

Every step may have `subtitle`, `pauseAfterMs`, and `timeoutMs`. Supported actions:

| Action | Required fields | Purpose |
| --- | --- | --- |
| `goto` | `path` or `url` | navigate |
| `click` | `selector` | click a visible control |
| `fill` | `selector`, `value` | replace input text |
| `type` | `selector`, `value` | type with optional `delayMs` |
| `press` | `selector`, `key` | press a key |
| `hover` | `selector` | reveal hover UI |
| `check` / `uncheck` | `selector` | change checkbox state |
| `select` | `selector`, `value` | select an option |
| `wait` | `durationMs` | deliberate pacing |
| `waitFor` | `selector` | wait for a visible element |
| `assertText` | `selector`, `text` | fail unless visible text contains value |
| `assertUrl` | `pattern` | fail unless URL contains value |
| `screenshot` | `name` | save a proof frame |

Prefer stable `data-testid` or accessible selectors. Use subtitles as concise narration, not click instructions. Target 2–7 seconds per caption and use `wait` actions to preserve reading time.

## Reliable demo design

1. Open with the problem and product claim in the first 15 seconds.
2. Demonstrate the smallest sequence proving each judging criterion.
3. Assert critical state after actions so a broken recording fails instead of silently continuing.
4. End with outcome, differentiation, and working links or next step.
5. Keep 10% margin under the official duration limit.

The recorder intentionally does not support arbitrary page JavaScript. Add a deterministic app fixture or explicit scenario action instead.

For competitions requiring spoken narration, use `--voiceover macos-say` on macOS. Keep each subtitle short enough to finish speaking before the next narrated step. Use `--voice`, `--speech-rate`, and step pauses to tune pacing. On other platforms, record or synthesize narration separately and mux it before packaging; captions alone do not satisfy an audio requirement.
