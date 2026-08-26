// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { renderOptions } from "../../src/options/view";
import { SETTINGS_KEY, TIERS_KEY, createSettingsStore, createTierStore } from "../../src/platform/storage";
import { createFakeBrowser, type FakeBrowser } from "../helpers/fake-browser";

let browser: FakeBrowser;
let root: HTMLElement;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount(): Promise<void> {
  const handle = renderOptions(root, {
    settings: createSettingsStore(browser),
    tiers: createTierStore(browser),
  });
  await handle.ready;
}

function stored(): Record<string, unknown> {
  return (browser.store.get(SETTINGS_KEY) ?? {}) as Record<string, unknown>;
}

function setField(selector: string, value: string): void {
  const field = root.querySelector<HTMLInputElement>(selector);
  if (!field) throw new Error(`no field matching ${selector}`);
  field.value = value;
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function toggle(selector: string): void {
  const field = root.querySelector<HTMLInputElement>(selector);
  if (!field) throw new Error(`no field matching ${selector}`);
  field.checked = !field.checked;
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function seedRules(rules: unknown[]): void {
  browser.seed({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, rules } });
}

beforeEach(() => {
  document.body.innerHTML = "<main id='root'></main>";
  root = document.getElementById("root") as HTMLElement;
  browser = createFakeBrowser();
});

describe("speed settings", () => {
  it("shows the current values", async () => {
    await mount();
    expect(root.querySelector<HTMLInputElement>("#defaultSpeed")?.value).toBe("2");
    expect(root.querySelector<HTMLInputElement>("#step")?.value).toBe("0.25");
    expect(root.querySelector<HTMLInputElement>("#presets")?.value).toBe("0.5, 1, 1.5, 2, 2.5, 3");
    expect(root.querySelector<HTMLInputElement>("#preservePitch")?.checked).toBe(true);
  });

  it("saves a new default, clamped to what the browser can play", async () => {
    await mount();
    setField("#defaultSpeed", "99");
    await settle();
    expect(stored().defaultSpeed).toBe(4);
  });

  it("saves a new step", async () => {
    await mount();
    setField("#step", "0.1");
    await settle();
    expect(stored().step).toBe(0.1);
  });

  it("saves presets", async () => {
    await mount();
    setField("#presets", "1, 2, 4");
    await settle();
    expect(stored().presets).toEqual([1, 2, 4]);
  });

  it("keeps the old presets when the line is unusable", async () => {
    await mount();
    setField("#presets", "nonsense");
    await settle();
    expect(stored().presets).toEqual(DEFAULT_SETTINGS.presets);
  });

  it("toggles pitch preservation", async () => {
    await mount();
    toggle("#preservePitch");
    await settle();
    expect(stored().preservePitch).toBe(false);
  });

  it("ignores a change from something that is not a settings field", async () => {
    await mount();
    root.querySelector("h1")?.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(browser.store.has(SETTINGS_KEY)).toBe(false);
  });
});

describe("site rules", () => {
  it("says when there are none", async () => {
    await mount();
    expect(root.querySelector(".rules .empty")?.textContent).toMatch(/no site rules/i);
  });

  it("adds a rule from the form", async () => {
    await mount();
    const form = root.querySelector<HTMLFormElement>(".add-rule");
    (form?.elements.namedItem("pattern") as HTMLInputElement).value = "  Music.YouTube.com ";
    (form?.elements.namedItem("speed") as HTMLInputElement).value = "1";
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(stored().rules).toEqual([
      expect.objectContaining({ pattern: "music.youtube.com", speed: 1, enabled: true }),
    ]);
  });

  it("explains a pattern it cannot match instead of saving it", async () => {
    await mount();
    const form = root.querySelector<HTMLFormElement>(".add-rule");
    (form?.elements.namedItem("pattern") as HTMLInputElement).value = "ex*ample";
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(root.querySelector(".notice")?.textContent).toMatch(/not a site/i);
    expect(browser.store.has(SETTINGS_KEY)).toBe(false);
  });

  it("lists existing rules", async () => {
    seedRules([{ id: "a", pattern: "example.com", speed: 1, enabled: true }]);
    await mount();
    expect(root.querySelectorAll(".rule")).toHaveLength(1);
    expect(root.querySelector<HTMLInputElement>(".rule .pattern")?.value).toBe("example.com");
    expect(root.querySelector(".rule .speed-label")?.textContent).toBe("1x");
  });

  it("edits a rule's speed", async () => {
    seedRules([{ id: "a", pattern: "example.com", speed: 1, enabled: true }]);
    await mount();
    setField('[data-field="ruleSpeed"]', "1.5");
    await settle();
    expect((stored().rules as { speed: number }[])[0]?.speed).toBe(1.5);
  });

  it("edits a rule's pattern, canonicalising it", async () => {
    seedRules([{ id: "a", pattern: "example.com", speed: 1, enabled: true }]);
    await mount();
    setField('[data-field="rulePattern"]', "  Other.TEST/Watch ");
    await settle();
    expect((stored().rules as { pattern: string }[])[0]?.pattern).toBe("other.test/Watch");
  });

  it("refuses a pattern it cannot match, leaving the rule as it was", async () => {
    seedRules([{ id: "a", pattern: "example.com", speed: 1, enabled: true }]);
    await mount();
    setField('[data-field="rulePattern"]', "ex*ample");
    await settle();
    expect(root.querySelector(".notice")?.textContent).toMatch(/not a site/i);
    expect(root.querySelector<HTMLInputElement>(".rule .pattern")?.value).toBe("example.com");
  });

  it("disables a rule without deleting it", async () => {
    seedRules([{ id: "a", pattern: "example.com", speed: 1, enabled: true }]);
    await mount();
    toggle('[data-field="ruleEnabled"]');
    await settle();
    expect((stored().rules as { enabled: boolean }[])[0]?.enabled).toBe(false);
  });

  it("removes a rule", async () => {
    seedRules([{ id: "a", pattern: "example.com", speed: 1, enabled: true }]);
    await mount();
    root.querySelector<HTMLElement>('[data-act="remove-rule"]')?.click();
    await settle();
    expect(stored().rules).toEqual([]);
  });

  it("ignores an edit aimed at a rule that is no longer there", async () => {
    seedRules([{ id: "a", pattern: "example.com", speed: 1, enabled: true }]);
    await mount();
    const field = root.querySelector<HTMLInputElement>('[data-field="ruleSpeed"]');
    if (field) field.dataset.value = "gone";
    setField('[data-field="ruleSpeed"]', "3");
    await settle();
    expect((stored().rules as { speed: number }[])[0]?.speed).toBe(1);
  });
});

describe("enforcement", () => {
  it("toggles automatic escalation", async () => {
    await mount();
    toggle("#autoEscalate");
    await settle();
    expect(stored().enforcement).toMatchObject({ autoEscalate: false });
  });

  it("toggles the in-page agent", async () => {
    await mount();
    toggle("#allowPageWorld");
    await settle();
    expect(stored().enforcement).toMatchObject({ allowPageWorld: false });
  });

  it("says when nothing has needed more effort yet", async () => {
    await mount();
    expect(root.querySelector(".learned .empty")).not.toBeNull();
  });

  it("lists what each site turned out to need", async () => {
    browser.seed({ [TIERS_KEY]: { "netflix.com": 3, "youtube.com": 1 } });
    await mount();
    const items = [...root.querySelectorAll(".learned li")].map((item) => item.textContent);
    expect(items).toEqual([
      "netflix.com — holds the speed from inside the page",
      "youtube.com — re-applies on change",
    ]);
  });

  it("forgets them all", async () => {
    browser.seed({ [TIERS_KEY]: { "netflix.com": 3 } });
    await mount();
    root.querySelector<HTMLElement>('[data-act="clear-tiers"]')?.click();
    await settle();
    expect(browser.store.has(TIERS_KEY)).toBe(false);
    expect(root.querySelector(".notice")?.textContent).toMatch(/forgot/i);
  });
});

describe("backup", () => {
  it("shows the current settings as text", async () => {
    await mount();
    const text = root.querySelector<HTMLTextAreaElement>("#export-text")?.textContent ?? "";
    expect(JSON.parse(text)).toMatchObject({ defaultSpeed: 2 });
  });

  it("imports pasted settings", async () => {
    await mount();
    const field = root.querySelector<HTMLTextAreaElement>("#import-text");
    if (field) field.value = JSON.stringify({ version: 1, defaultSpeed: 3 });
    root.querySelector<HTMLElement>('[data-act="import"]')?.click();
    await settle();

    expect(stored().defaultSpeed).toBe(3);
    expect(root.querySelector<HTMLInputElement>("#defaultSpeed")?.value).toBe("3");
  });

  it("explains unreadable text instead of wiping anything", async () => {
    await mount();
    const field = root.querySelector<HTMLTextAreaElement>("#import-text");
    if (field) field.value = "{not json";
    root.querySelector<HTMLElement>('[data-act="import"]')?.click();
    await settle();

    expect(root.querySelector(".notice")?.textContent).toMatch(/could not be read/i);
    expect(browser.store.has(SETTINGS_KEY)).toBe(false);
  });
});

describe("stray interactions", () => {
  it("ignores a settings field it does not know", async () => {
    await mount();
    const stray = document.createElement("input");
    stray.dataset.field = "nonsense";
    root.append(stray);
    stray.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(browser.store.has(SETTINGS_KEY)).toBe(false);
  });

  it("copes with a form that has no fields", async () => {
    await mount();
    const form = document.createElement("form");
    root.append(form);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector(".notice")?.textContent).toMatch(/not a site/i);
  });

  it("copes with an import when there is nothing to import", async () => {
    await mount();
    root.querySelector("#import-text")?.remove();
    root.querySelector<HTMLElement>('[data-act="import"]')?.click();
    await settle();
    expect(root.querySelector(".notice")?.textContent).toMatch(/could not be read/i);
  });


  it("ignores a click that is not an action", async () => {
    await mount();
    const before = root.innerHTML;
    root.querySelector("h1")?.click();
    await settle();
    expect(root.innerHTML).toBe(before);
  });

  it("ignores an action it does not know", async () => {
    await mount();
    const stray = document.createElement("button");
    stray.dataset.act = "self-destruct";
    root.append(stray);
    stray.click();
    await settle();
    expect(browser.store.has(SETTINGS_KEY)).toBe(false);
  });
});
