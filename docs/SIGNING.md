# Signing and installing in Zen

There are two routes. Check the first before spending time on the second.

## The short route: Zen builds usually do not require a signature

Zen is an unofficial Firefox build, and the ones shipped so far are compiled with
signature enforcement off. Confirm it for the build you have:

```sh
mkdir -p /tmp/zen-omni && cd /tmp/zen-omni
unzip -qo /opt/zen-browser-bin/omni.ja greprefs.js modules/AppConstants.sys.mjs
grep -o 'MOZ_REQUIRE_SIGNING:[^,]*' modules/AppConstants.sys.mjs
grep -n 'xpinstall.signatures' greprefs.js
```

(`/opt/zen-browser-bin` is where the Arch `zen-browser-bin` package puts it;
`dirname "$(readlink -f "$(command -v zen-browser)")"` finds it elsewhere.)

`MOZ_REQUIRE_SIGNING: false` and `pref("xpinstall.signatures.required", false)`
mean an unsigned `.xpi` installs permanently — no AMO round trip. Check that
nothing overrides it: `distribution/policies.json` next to the binary, and
`user.js` / `prefs.js` in your profile under `~/.config/zen/`.

If that holds, `npm run package` is the whole build, and you install
`dist/steady-<version>.xpi` through `about:addons` → gear →
**Install Add-on From File…**.

Verified on Zen 1.21.15b (`zen-browser-bin`, Gecko 154) on 2026-08-26: both
constants false, no overrides, unsigned install worked. Re-check after a Zen
update — it is a build-time flag and could change.

Note that `/usr/bin/firefox` from a distribution package *is* a Mozilla release
build and does still require a signature. So does anyone else's browser, which is
why the long route exists.

## The long route: AMO unlisted signing

Needed for a Mozilla release build, or to hand the add-on to someone else. Use
**AMO unlisted self-distribution** — Mozilla signs the file without review and
never lists it publicly.

There is no local alternative: Firefox trusts exactly one signing root, Mozilla's,
and it is hardcoded. You cannot self-sign an `.xpi` that a signature-enforcing
build will accept. The only other way to run unsigned code there is a temporary
install through `about:debugging`, which `npm run try` does for you and which
disappears when the browser closes.

## Once, to set up

1. Sign in at <https://addons.mozilla.org/> with a Firefox account.
2. Go to <https://addons.mozilla.org/developers/addon/api/key/> and generate API
   credentials. You get a **JWT issuer** (`user:12345:67`) and a **JWT secret**.
   Keep the secret out of this repository — pass it on the command line or via
   the environment.

## Every time you want a new build

```sh
npm ci
npm run check          # typecheck, tests with coverage gates, build, guard
npm run package        # writes dist/steady-<version>.xpi and prints its sha256
```

Then hand that build to Mozilla for signing:

```sh
npx --yes web-ext sign \
  --channel unlisted \
  --source-dir dist/firefox \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"
```

`web-ext` is deliberately **not** a dependency of this project — `npx` fetches it
only when you sign, so it is never part of a normal build.

The signed file lands in `web-ext-artifacts/`, under a generated name like
`07ee1d6c0ed4409884bd-0.1.0.xpi`. Open it in Zen with `about:addons` → the gear
icon → **Install Add-on From File…**, or just drag it onto the browser window.

Unlisted submissions are meant to sign automatically in minutes, but the run on
2026-08-26 sat at **waiting for approval** for some time before completing. It
does finish. If it never does, check the submission is on the *unlisted* channel —
listed submissions get a human review, take days, and publish the add-on
publicly.

## Updating later

Bump `version` in `package.json`, run the same commands, and install the new
signed file over the old one. The extension id in
`scripts/manifest.mjs` never changes, which is what makes it an update rather
than a second copy.

## Checking you got what you built

`npm run package` prints a SHA-256 of the unsigned archive, and `npm run verify`
builds it twice to prove the output does not depend on the clock or the
machine. Mozilla re-zips the archive when it signs, so the signed file's hash
will differ — but you can unzip the signed `.xpi` and compare the individual
files against `dist/firefox/`, which will match byte for byte.

## Permissions Firefox will show you

- **Access your data for all websites** — the content script has to run wherever
  media plays. Firefox 128 shows this at install time and lets you revoke it
  per-site afterwards.

Nothing else is requested. If Firefox ever shows you a permission not on this
list, something has changed that you did not build — do not install it.
