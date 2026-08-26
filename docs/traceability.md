# Requirements to tests

One row per thing you asked for, and the tests that prove it. A requirement with
nothing in the right-hand column is a requirement nobody has checked.

## The six numbered requirements

| # | Requirement | Where it is proved |
| --- | --- | --- |
| 1 | Works on any website | `content_scripts` matches `http`, `https` and `file` in `scripts/manifest.mjs`, asserted by `test/guard.test.ts`; per-frame behaviour in `test/dom/adversarial.test.ts` ("a same-origin iframe…") and `test/dom/controller.test.ts` |
| 1 | Works on DRM content | Not a separate mechanism — EME playback goes through `HTMLMediaElement` like everything else. What varies is how hard the player fights, covered by `test/dom/adversarial.test.ts` and `docs/enforcement-matrix.md`. Final confirmation is manual: `docs/manual-firefox-checklist.md` |
| 2 | Extremely simple and lightweight | Idle cost asserted in `test/core/reconciler.test.ts` ("does nothing at all below the reconcile tier", "does no work while the page is hidden"); conditional writes in `test/dom/enforcer.test.ts` ("writes nothing when the element is already at the target"); size budgets in `scripts/guard.mjs` |
| 3 | Defaults to your speed on every site and every reload | `test/dom/controller.test.ts` — "brings media on the page to the default speed", "uses a stored default rather than the built-in one", "applies to media that turns up later"; reload is the same code path as first load |
| 4 | Change the speed away from the default | `test/dom/controller.test.ts` — "steps up and down by the configured step", "toggles between normal and the site's speed", "resets back to what the rules say"; hotkey delivery in `test/platform/background.test.ts`; popup in `test/dom/popup.test.ts` |
| 5 | A list of sites that run at 1x, overriding the default | `test/core/rules.test.ts` — "supports the always-1x case the site list exists for"; `test/dom/controller.test.ts` — "pins a site to 1x when a rule says so"; editing in `test/dom/options.test.ts` and `test/dom/popup.test.ts` |
| 6 | Runs on Zen | Manifest targets Gecko 128+ with an explicit add-on id (`scripts/manifest.mjs`); the build is a signing-ready `.xpi` (`test/zip.test.ts`, `npm run verify`). Zen enforces signatures, so this is only *proved* by installing a signed build — `docs/SIGNING.md` and the manual checklist |

## The requirements behind the requirements

| Requirement | Where it is proved |
| --- | --- |
| Nothing phones home | `scripts/guard.mjs` scans the built bundle for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `eval`, `new Function`, and remote script URLs; the scanner itself is tested in `test/guard.test.ts` |
| No unnecessary permissions | `test/guard.test.ts` — "passes the manifest we actually ship"; the forbidden list lives in `scripts/manifest.mjs` |
| Zero runtime dependencies | `scripts/deps-report.mjs` exits non-zero if `dependencies` is ever non-empty |
| Corrupt or hostile stored data cannot break playback | `test/core/settings.test.ts` (the whole `normalizeSettings` suite), `test/platform/storage.test.ts` ("normalises whatever is stored…", "falls back to the defaults if storage itself fails"), `test/platform/tier-store.test.ts` |
| Cannot be dragged into a loop by a hostile page | `test/dom/enforcer.test.ts` loop-protection suite; `test/dom/adversarial.test.ts` — "a ratechange rewrite loop is bounded" |
| Does not leak media elements | `test/core/weak-set.test.ts` — "forgets entries whose target was collected", "lets a collected target be added again" |
| The build is reproducible | `npm run verify`; determinism of the archive in `test/zip.test.ts` |

## What no test covers

These are real gaps, not oversights, and each has a line in the manual checklist:

- **Page-world injection under a real Content-Security-Policy.** The bridge's
  failure path is tested; whether a given site's CSP triggers it is not
  reproducible outside a browser.
- **Real DRM playback.** No Widevine in the environment this was built in, and no
  accounts.
- **Firefox's own behaviour** — the MV3 host-permission flow, and where Firefox
  actually mutes audio at the edges of the speed range.
