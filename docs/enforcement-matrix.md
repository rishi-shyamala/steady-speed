# Enforcement matrix

Which rung of the ladder each behaviour actually needs. Every row is asserted by
a fixture in `test/dom/adversarial.test.ts`, so this table cannot drift away from
what the code does.

| Page behaviour | Lowest rung that wins | Notes |
| --- | --- | --- |
| Plain `<video>` in the light DOM | **T0** passive | Applied during the initial sweep |
| Media added after load | **T0** passive | MutationObserver, batched through an idle callback |
| Media two open shadow roots deep | **T0** passive | Found by the budgeted shadow-host crawl |
| Source switch mid-playback | **T0** passive | `loadedmetadata` re-applies |
| Media created detached, then attached | **T0** passive | Events cannot reach us until it is connected |
| Same-origin iframe | **T0** passive | Each frame runs its own instance |
| Player resets the rate on `play` | **T1** reactive | The reset fires `ratechange`, which we correct |
| Player resets the rate on `seeked` | **T1** reactive | Same mechanism |
| Player resets the rate without firing an event | **T2** reconcile | Only the periodic check can see it |
| Player re-asserts on every `ratechange` | escalates; effort bounded | The loop guard makes exactly `reapplyLimit` attempts, then backs off |
| Page locks `playbackRate` with a property definition | **T3** page world | Isolated-world writes are accepted and discarded |

## What the isolated-world tests cannot prove

The last two rows escalate correctly and stay bounded, but beating them needs the
page-world agent, which by definition cannot be exercised from an isolated-world
test. Those are verified in the browser checklist instead.

DRM is not on this list because it is not a separate mechanism: EME playback runs
through `HTMLMediaElement` like everything else, so `playbackRate` applies
normally. What makes a DRM site hard is which row above its player falls into.
