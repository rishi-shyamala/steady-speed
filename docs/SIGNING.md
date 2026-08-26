# Signing and installing in Zen

Zen inherits Firefox's signature enforcement: an unsigned `.xpi` will not install
on a release build, whatever you set `xpinstall.signatures.required` to. The route
that works, and keeps the add-on private to you, is **AMO unlisted
self-distribution** — Mozilla signs the file automatically, without review, and
never lists it publicly.

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

The signed file lands in `web-ext-artifacts/`. Open it in Zen with
`about:addons` → the gear icon → **Install Add-on From File…**, or just drag it
onto the browser window.

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
