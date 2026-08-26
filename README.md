# Steady

A minimal, auditable playback-rate controller for Firefox and Zen Browser.

Sets your chosen speed on every `<video>` and `<audio>` element, on every site, on
every reload — with a per-site rule list that can pin any site to any speed.

## Why it is written this way

The reason to build your own speed controller is that extensions get hijacked, so
this one is built to be *read*:

- **Zero runtime dependencies.** `dependencies` is empty and stays empty.
- **No network code.** `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`, `eval` and `new Function` are all rejected by `npm run guard`,
  which scans the built bundle, not the source.
- **Minimal permissions.** `storage` plus host access. `npm run guard` fails the
  build if the manifest ever requests `tabs`, `cookies`, `webRequest`,
  `webNavigation`, `scripting`, `clipboard*`, `nativeMessaging` or friends.
- **No minification.** The shipped bundle is the same code you read here, under a
  25 KB budget enforced by the guard.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | typecheck, coverage-gated tests, build, guard — the full gate |
| `npm test` | unit and DOM tests |
| `npm run coverage` | tests with coverage thresholds enforced |
| `npm run build` | build `dist/firefox` |
| `npm run guard` | static guarantees against the built artifact |
| `npm run deps:report` | exactly what is trusted at build time |

## Layout

    src/core/       pure logic, no browser APIs
    src/platform/   the only files that touch browser.*
    src/content/    per-frame media discovery and rate enforcement
    src/page/       page-world agent, injected only on escalation
    src/background/ hotkeys and toolbar badge
    scripts/        build and static guards
    test/           unit, DOM, and adversarial suites
