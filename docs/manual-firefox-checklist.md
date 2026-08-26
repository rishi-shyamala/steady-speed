# The pass to run once in Zen

Everything below is checked automatically except the parts that need a real
Gecko engine or a real DRM stack. Neither exists in the environment this was
built in, so this is the list to walk once after installing.

Install the signed build (see `SIGNING.md`), then set your default speed in the
popup before starting.

## Basics

- [ ] A plain `<video>` page plays at your default speed on load.
- [ ] Reloading keeps it at your default speed.
- [ ] A brand new tab on a different site also starts at your default speed.
- [ ] The toolbar badge shows the speed, and is blank at 1x.
- [ ] `Alt+.` and `Alt+,` step the speed; `Alt+/` toggles 1x; `Alt+0` resets.
- [ ] Hotkeys still work with the video fullscreen.
- [ ] Audio is still audible at 0.25x and at 4x. If it is silent at one end,
      note where — Firefox mutes outside a range and the bounds may need moving.
- [ ] Speech still sounds natural (pitch preserved) at 2x.

## Site rules

- [ ] Pin a site to 1x from the popup; reload; it plays at 1x.
- [ ] Another site still plays at your default.
- [ ] The rule appears in the settings page and can be edited and removed there.

## Real players

For each: does it start at your default speed, and stay there through an ad
break, a quality change, and a seek?

- [ ] YouTube
- [ ] YouTube after an ad
- [ ] Netflix
- [ ] Prime Video
- [ ] Spotify web player
- [ ] Twitch (live and VOD)
- [ ] Vimeo
- [ ] A course player (Coursera, Udemy, or similar)
- [ ] A podcast page with an `<audio>` element
- [ ] A local file opened with `file:///`

If one of these needs several seconds to settle, open the settings page and look
at **What each site has needed** — that is the extension telling you which rung
it had to climb.

## The parts that could not be tested automatically

- [ ] **Page-world injection works at all.** Find a site the ladder escalates to
      the top rung on, and confirm the speed holds. If it never holds, the page's
      Content-Security-Policy may be refusing the injected script — that is the
      one failure mode the isolated-world tests cannot reproduce.
- [ ] **MV3 host permissions.** Firefox 128 shows host access at install time and
      lets you revoke it per site. Revoke it for one site and confirm the popup
      says there are no media controls there rather than silently doing nothing.
- [ ] **A cross-origin iframe player** (an embedded YouTube or Vimeo on a blog).
- [ ] **A picture-in-picture window** keeps the speed.

## If something is wrong

Note which site, which of the four rungs the settings page says it reached, and
whether the speed was wrong from the start or drifted later. Those three facts
identify which layer to look at.
