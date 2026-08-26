# Reading the whole thing

The reason to build your own speed controller is not to have a better one; it is
to be able to check it. This is a guided path through every file that ships,
shortest and most security-relevant first.

The built extension is eleven files. Five are JavaScript, and only one of them —
`content.js` — runs on pages you visit.

## Start with the guarantees

| File | What to check |
| --- | --- |
| `scripts/guard.mjs` | The rules the build enforces: no network APIs, no dynamic code, no forbidden permissions, per-file size budgets. |
| `scripts/guard-lib.mjs` | How those rules are actually applied to the built bundle — not to the source, so nothing can hide behind the compiler. |
| `scripts/manifest.mjs` | The single source of truth for what the extension asks the browser for. |
| `package.json` | `dependencies` is empty, and `npm run deps:report` fails the build if it ever is not. |

Then run `npm run package` and `unzip -l` the result: eleven files, no more.

## Then the surface that touches the outside world

| File | What it does |
| --- | --- |
| `src/platform/webext.ts` | Hand-written declarations of *every* browser API this extension can reach. If an API is not in this file, no other file can call it. |
| `src/platform/storage.ts` | The only code that reads or writes storage. Two keys: settings, and a bounded cache of which sites fight back. |
| `src/platform/messages.ts` | Every message that crosses between the background page, the popup and a frame. Anything not listed is ignored. |

## Then the page-world agent

`src/page/agent.ts` is the largest attack surface in the project: it is the only
code that runs inside a page's own JavaScript world, where it redefines two
properties on `HTMLMediaElement.prototype`. It is deliberately small, it is
injected only when the enforcement ladder has established that nothing cheaper
works, and it can be switched off entirely in the settings page.

`src/content/page-bridge.ts` is what injects it. Note that the script URL comes
from `browser.runtime.getURL` — the extension's own package — and the guard
rejects any assignment of an `http(s)` URL to a `src`.

## Then the rest

| File | Why it exists |
| --- | --- |
| `src/core/speed.ts` | Speed arithmetic in integer hundredths. No browser APIs. |
| `src/core/rules.ts` | Which speed applies where. No browser APIs. |
| `src/core/settings.ts` | Turns anything at all into settings that are safe to act on. |
| `src/core/escalation.ts` | The enforcement ladder as a pure state machine. |
| `src/core/rate-limit.ts` | The sliding window that stops a fight with a page becoming a loop. |
| `src/core/weak-set.ts` | Why tracking media elements does not leak them. |
| `src/content/discovery.ts` | How media is found: capture listeners, one sweep, a filtered observer, shadow roots. |
| `src/content/enforcer.ts` | Applying the rate, and noticing when a site takes it back. |
| `src/content/reconciler.ts` | The periodic net that is off by default and turns itself off again. |
| `src/content/controller.ts` | The wiring for one frame. |
| `src/background/index.ts` | Hotkeys and the toolbar badge. Nothing else. |
| `src/popup/`, `src/options/` | Interface only; they cannot reach anything `src/platform` does not expose. |

## What to be suspicious of in any speed controller

- A network call of any kind. There is no honest reason for one.
- Permissions beyond `storage` and host access — especially `tabs`, `cookies`,
  `webRequest` or `nativeMessaging`.
- Minified or bundled-from-elsewhere code in the shipped package.
- Remote script injection: a `<script src>` pointing anywhere but the extension's
  own `moz-extension://` package.
- An update that quietly adds any of the above.
