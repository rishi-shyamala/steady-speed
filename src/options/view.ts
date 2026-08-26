/**
 * The settings page.
 *
 * Every control writes through `normalizeSettings`, so nothing typed here can
 * put the extension into a state it cannot recover from — and the same is true
 * of an imported file.
 */

import type { Tier } from "../core/escalation";
import { normalizePattern, type SiteRule } from "../core/rules";
import {
  createRule,
  parseSettingsJson,
  removeRule,
  serializeSettings,
  upsertRule,
  type Settings,
} from "../core/settings";
import { MAX_SPEED, MIN_SPEED, conformSpeed } from "../core/speed";
import type { SettingsStore, TierStore } from "../platform/storage";
import { describeLearnedTier, formatPresets, parsePresets, ruleSpeedLabel } from "./model";

export interface OptionsDeps {
  settings: SettingsStore;
  tiers: TierStore;
}

export interface OptionsHandle {
  ready: Promise<void>;
}

export function renderOptions(root: HTMLElement, deps: OptionsDeps): OptionsHandle {
  let settings: Settings;
  let learned: Record<string, Tier> = {};
  let notice = "";

  const draw = (): void => {
    root.replaceChildren(build(settings, learned, notice));
    notice = "";
  };

  const reload = async (): Promise<void> => {
    [settings, learned] = await Promise.all([deps.settings.load(), deps.tiers.list()]);
    draw();
  };

  const save = async (apply: (current: Settings) => Settings): Promise<void> => {
    settings = await deps.settings.update(apply);
    draw();
  };

  root.addEventListener("change", (event) => {
    const field = event.target as HTMLInputElement | null;
    if (field?.dataset.field) void onField(field);
  });

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-act]");
    if (button) void onAction(String(button.dataset.act), button.dataset.value);
  });

  root.addEventListener("submit", (event) => {
    event.preventDefault();
    void onAddRule(event.target as HTMLFormElement);
  });

  async function onField(field: HTMLInputElement): Promise<void> {
    const value = field.value;
    switch (field.dataset.field) {
      case "defaultSpeed":
        return save((current) => ({ ...current, defaultSpeed: conformSpeed(Number(value)) }));
      case "step":
        return save((current) => ({ ...current, step: Number(value) }));
      case "presets": {
        const presets = parsePresets(value);
        return save((current) => (presets ? { ...current, presets } : current));
      }
      case "preservePitch":
        return save((current) => ({ ...current, preservePitch: field.checked }));
      case "autoEscalate":
      case "allowPageWorld":
        return save((current) => ({
          ...current,
          enforcement: { ...current.enforcement, [String(field.dataset.field)]: field.checked },
        }));
      case "ruleSpeed":
        return updateRule(String(field.dataset.value), (rule) => ({
          ...rule,
          speed: conformSpeed(Number(value)),
        }));
      case "rulePattern": {
        const pattern = normalizePattern(value);
        if (!pattern) {
          notice = `"${value}" is not a site this can match.`;
          return draw();
        }
        return updateRule(String(field.dataset.value), (rule) => ({ ...rule, pattern }));
      }
      case "ruleEnabled":
        return updateRule(String(field.dataset.value), (rule) => ({
          ...rule,
          enabled: field.checked,
        }));
      default:
        return;
    }
  }

  function updateRule(id: string, apply: (rule: SiteRule) => SiteRule): Promise<void> {
    return save((current) => {
      const rule = current.rules.find((candidate) => candidate.id === id);
      return rule ? upsertRule(current, apply(rule)) : current;
    });
  }

  async function onAction(action: string, value?: string): Promise<void> {
    switch (action) {
      case "remove-rule":
        return save((current) => removeRule(current, String(value)));
      case "clear-tiers":
        await deps.tiers.clear();
        learned = {};
        notice = "Forgot what every site needed. They will be re-learned as you browse.";
        return draw();
      case "import":
        return onImport();
      default:
        return;
    }
  }

  async function onAddRule(form: HTMLFormElement): Promise<void> {
    const pattern = (form.elements.namedItem("pattern") as HTMLInputElement | null)?.value ?? "";
    const speed = Number((form.elements.namedItem("speed") as HTMLInputElement | null)?.value);
    const rule = createRule(pattern, speed);
    if (!rule) {
      notice = `"${pattern}" is not a site this can match.`;
      return draw();
    }
    return save((current) => upsertRule(current, rule));
  }

  async function onImport(): Promise<void> {
    const field = root.querySelector<HTMLTextAreaElement>("#import-text");
    const result = parseSettingsJson(field?.value ?? "");
    if (!result.ok) {
      notice = result.error;
      return draw();
    }
    notice = "Settings imported.";
    return save(() => result.settings);
  }

  return { ready: reload() };
}

function build(settings: Settings, learned: Record<string, Tier>, notice: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(el("h1", {}, "Steady"));
  if (notice) fragment.append(el("p", { class: "notice", role: "status" }, notice));
  fragment.append(
    speedSection(settings),
    rulesSection(settings),
    enforcementSection(settings, learned),
    backupSection(settings),
  );
  return fragment;
}

function speedSection(settings: Settings): HTMLElement {
  return section(
    "Speed",
    "What plays where, before any site rules.",
    field("Default speed", numberInput("defaultSpeed", settings.defaultSpeed, settings.step)),
    field("Step size", numberInput("step", settings.step, 0.05)),
    field(
      "Popup presets",
      el("input", {
        type: "text",
        id: "presets",
        "data-field": "presets",
        value: formatPresets(settings.presets),
      }),
    ),
    field(
      "Keep pitch natural",
      el("input", {
        type: "checkbox",
        id: "preservePitch",
        "data-field": "preservePitch",
        ...(settings.preservePitch ? { checked: "checked" } : {}),
      }),
    ),
  );
}

function rulesSection(settings: Settings): HTMLElement {
  const list = el("ul", { class: "rules" });
  for (const rule of settings.rules) list.append(ruleRow(rule));
  if (settings.rules.length === 0) {
    list.append(el("li", { class: "empty" }, "No site rules yet."));
  }

  const form = el(
    "form",
    { class: "add-rule" },
    el("input", { type: "text", name: "pattern", placeholder: "example.com", "aria-label": "Site" }),
    el("input", {
      type: "number",
      name: "speed",
      value: "1",
      min: String(MIN_SPEED),
      max: String(MAX_SPEED),
      step: "0.25",
      "aria-label": "Speed",
    }),
    el("button", { type: "submit" }, "Add rule"),
  );

  return section(
    "Sites",
    "Most specific match wins: more host labels first, then an exact host, then a deeper path. " +
      "Write example.com for a domain and its subdomains, *.example.com for subdomains only, " +
      "=example.com for that host exactly, or add /a/path to narrow it.",
    list,
    form,
  );
}

function ruleRow(rule: SiteRule): HTMLElement {
  return el(
    "li",
    { class: "rule" },
    el("input", {
      type: "checkbox",
      "data-field": "ruleEnabled",
      "data-value": rule.id,
      "aria-label": `Enable ${rule.pattern}`,
      ...(rule.enabled ? { checked: "checked" } : {}),
    }),
    el("input", {
      type: "text",
      class: "pattern",
      "data-field": "rulePattern",
      "data-value": rule.id,
      "aria-label": "Site",
      value: rule.pattern,
    }),
    el("input", {
      type: "number",
      class: "speed",
      "data-field": "ruleSpeed",
      "data-value": rule.id,
      "aria-label": `Speed for ${rule.pattern}`,
      min: String(MIN_SPEED),
      max: String(MAX_SPEED),
      step: "0.25",
      value: String(rule.speed),
    }),
    el("span", { class: "speed-label" }, ruleSpeedLabel(rule.speed)),
    el(
      "button",
      { type: "button", "data-act": "remove-rule", "data-value": rule.id },
      "Remove",
    ),
  );
}

function enforcementSection(settings: Settings, learned: Record<string, Tier>): HTMLElement {
  const hosts = Object.entries(learned).filter(([, tier]) => tier > 0);
  const list = el("ul", { class: "learned" });
  for (const [host, tier] of hosts) list.append(el("li", {}, describeLearnedTier(host, tier)));
  if (hosts.length === 0) list.append(el("li", { class: "empty" }, "No site has needed more yet."));

  return section(
    "How hard to insist",
    "Sites that reset the speed are met with more effort, one step at a time, and less again once they settle.",
    field(
      "Escalate automatically",
      el("input", {
        type: "checkbox",
        id: "autoEscalate",
        "data-field": "autoEscalate",
        ...(settings.enforcement.autoEscalate ? { checked: "checked" } : {}),
      }),
    ),
    field(
      "Allow the in-page agent",
      el("input", {
        type: "checkbox",
        id: "allowPageWorld",
        "data-field": "allowPageWorld",
        ...(settings.enforcement.allowPageWorld ? { checked: "checked" } : {}),
      }),
    ),
    el("h3", {}, "What each site has needed"),
    list,
    el("button", { type: "button", "data-act": "clear-tiers" }, "Forget all of them"),
  );
}

function backupSection(settings: Settings): HTMLElement {
  return section(
    "Backup",
    "Nothing leaves this machine. Copy the text below to keep a backup, or paste one in to restore it.",
    el("textarea", { id: "export-text", readonly: "readonly", rows: "8", "aria-label": "Current settings" }, serializeSettings(settings)),
    el("textarea", { id: "import-text", rows: "4", placeholder: "Paste settings here", "aria-label": "Settings to import" }),
    el("button", { type: "button", "data-act": "import" }, "Import"),
  );
}

function section(title: string, blurb: string, ...children: Node[]): HTMLElement {
  return el(
    "section",
    {},
    el("h2", {}, title),
    el("p", { class: "blurb" }, blurb),
    ...children,
  );
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el("div", { class: "field" }, el("label", { for: control.id }, label), control);
}

function numberInput(name: string, value: number, step: number): HTMLElement {
  return el("input", {
    type: "number",
    id: name,
    "data-field": name,
    min: String(MIN_SPEED),
    max: String(MAX_SPEED),
    step: String(step),
    value: String(value),
  });
}

type Attrs = Record<string, string>;

function el(tag: string, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
