import { describe, expect, it } from "vitest";
import {
  DEFAULT_ESCALATION_CONFIG,
  type EscalationConfig,
  type EscalationState,
  type Tier,
  ceilingTier,
  createEscalationState,
  needsPageWorld,
  needsReconcile,
  recordCalm,
  recordDivergence,
  shouldReapply,
} from "../../src/core/escalation";

const config = (overrides: Partial<EscalationConfig> = {}): EscalationConfig => ({
  ...DEFAULT_ESCALATION_CONFIG,
  ...overrides,
});

/** Feeds n divergences one millisecond apart, starting at `from`. */
function diverge(times: number, from = 0, options: EscalationConfig = config()) {
  let state = createEscalationState(0, from);
  for (let i = 0; i < times; i += 1) state = recordDivergence(state, from + i, options);
  return state;
}

describe("starting point", () => {
  it("costs nothing until a site misbehaves", () => {
    const state = createEscalationState();
    expect(state.tier).toBe(0);
    expect(shouldReapply(state.tier)).toBe(false);
    expect(needsReconcile(state.tier)).toBe(false);
    expect(needsPageWorld(state.tier)).toBe(false);
  });

  it("can start from a tier learned on an earlier visit", () => {
    expect(createEscalationState(2, 100)).toEqual({ tier: 2, divergences: [], quietSince: 100 });
  });
});

describe("climbing", () => {
  it("leaves tier 0 on the very first surprise", () => {
    expect(diverge(1).tier).toBe(1);
  });

  it("needs repeated evidence to go beyond reactive", () => {
    expect(diverge(2).tier).toBe(1);
    expect(diverge(3).tier).toBe(1);
    expect(diverge(4).tier).toBe(2);
  });

  it("climbs one rung at a time, each needing its own evidence", () => {
    expect(diverge(7).tier).toBe(3);
  });

  it("stops at the top", () => {
    expect(diverge(40).tier).toBe(3);
  });

  it("stops below page-world when that is not allowed", () => {
    const options = config({ allowPageWorld: false });
    expect(ceilingTier(options)).toBe(2);
    expect(diverge(40, 0, options).tier).toBe(2);
  });

  it("does not climb at all when auto-escalation is off", () => {
    const options = config({ autoEscalate: false });
    const state = diverge(40, 0, options);
    expect(state.tier).toBe(0);
    expect(state.divergences.length).toBeGreaterThan(0);
  });

  it("forgets divergences that fall outside the window", () => {
    const options = config({ windowMs: 1000, climbThreshold: 3 });
    let state = createEscalationState(0, 0);
    state = recordDivergence(state, 0, options);
    expect(state.tier).toBe(1);

    state = recordDivergence(state, 100, options);
    state = recordDivergence(state, 5_000, options);
    state = recordDivergence(state, 5_100, options);
    expect(state.tier).toBe(1);

    state = recordDivergence(state, 5_200, options);
    expect(state.tier).toBe(2);
  });

  it("records the surprise even when it does not climb", () => {
    const state = recordDivergence(createEscalationState(1, 0), 500, config());
    expect(state.divergences).toEqual([500]);
    expect(state.quietSince).toBe(500);
  });
});

describe("dropping back", () => {
  it("stays put while the site is still misbehaving", () => {
    const options = config({ calmMs: 1000 });
    const state: EscalationState = { tier: 2, divergences: [], quietSince: 500 };
    expect(recordCalm(state, 1000, options).tier).toBe(2);
  });

  it("drops one tier after a quiet stretch", () => {
    const options = config({ calmMs: 1000 });
    const state: EscalationState = { tier: 2, divergences: [], quietSince: 500 };
    expect(recordCalm(state, 1500, options).tier).toBe(1);
  });

  it("walks all the way back down to free", () => {
    const options = config({ calmMs: 1000 });
    let state: EscalationState = { tier: 3, divergences: [], quietSince: 0 };
    state = recordCalm(state, 1000, options);
    state = recordCalm(state, 2000, options);
    state = recordCalm(state, 3000, options);
    expect(state.tier).toBe(0);
  });

  it("does nothing at tier 0", () => {
    const state = createEscalationState(0, 0);
    expect(recordCalm(state, 10_000_000, config())).toBe(state);
  });
});

describe("tier predicates", () => {
  it("say what each rung turns on", () => {
    expect([0, 1, 2, 3].map((t) => shouldReapply(t as Tier))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect([0, 1, 2, 3].map((t) => needsReconcile(t as Tier))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect([0, 1, 2, 3].map((t) => needsPageWorld(t as Tier))).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });
});
