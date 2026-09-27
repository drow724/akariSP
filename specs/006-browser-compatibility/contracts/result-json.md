# Contract: Compatibility Result JSON (test report, not a production API)

```json
{
  "recordedAt": "2026-09-27T08:00:00.000Z",
  "runner": { "kind": "manual", "browser": "Chrome" },
  "userAgent": "…diagnostic only…",
  "secureContext": true,
  "capability": {
    "languageModelPresent": true,
    "availability": "available",
    "classification": "MODEL_AVAILABLE",
    "error": null
  },
  "tests": {
    "import":                  { "status": "PASS" },
    "run":                     { "status": "PASS", "durationMs": 812 },
    "streaming":               { "status": "PASS" },
    "earlyBreak":              { "status": "PASS" },
    "callerAbort":             { "status": "PASS" },
    "shutdownDuringStreaming": { "status": "PASS" },
    "lazyStream":              { "status": "PASS" },
    "cloneIsolation":          { "status": "PASS", "info": { "marker": "3f9a1c07", "markerObservedInOtherTask": false } }
  },
  "overall": "PASS"
}
```

- `runner`: declared via URL parameters, never inferred (research C3):
  `{ kind: "playwright", engine: "chromium" | "firefox" | "webkit" }`,
  `{ kind: "manual", browser: <label> | null }`, or `{ kind: "ci-safari" }` (reserved; not in
  006). A `playwright`/`webkit` document is engine evidence, never Safari evidence.
- `availability`: raw value, or `null` when the API or `availability()` is absent.
- `classification`: `API_ABSENT | API_PRESENT_UNAVAILABLE | MODEL_DOWNLOADABLE |
  MODEL_DOWNLOADING | MODEL_AVAILABLE | UNKNOWN_AVAILABILITY`.
- `capability.error` / per-test `error`: `{ name, constructor, message, code?, causeName? }` or
  absent. Diagnostic only.
- Per test: `status` (`PASS | FAIL | BLOCKED | SKIPPED`) required once recorded; `reason`
  required for non-PASS; `durationMs`, `error`, `info` optional. A test not yet run is absent.
- `info`: free-form diagnostic evidence; never read by the outcome logic.
- `overall`: `PASS | FAIL | BLOCKED | SKIPPED | INCOMPLETE` (research C6).
- No schema library; the shape is documented here and exercised by `test/report.test.ts`.
