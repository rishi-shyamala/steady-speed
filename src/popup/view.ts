/**
 * The popup. Small enough to hold in your head: read the frame's state, draw it,
 * and turn a click back into one message or one settings update.
 */

import { NORMAL_SPEED, formatSpeed, speedsEqual } from "../core/speed";
import { setSpeedForUrl, removeRule, type Settings } from "../core/settings";
import type { SettingsStore } from "../platform/storage";
import type { ContentState } from "../platform/messages";
import { buildPopupModel, describeTier, type PopupModel } from "./model";
import type { TabClient } from "./tab-client";

export interface PopupDeps {
  client: TabClient;
  settings: SettingsStore;
  openOptions: () => void;
}

export interface PopupHandle {
  /** Resolves when the first render is on screen. */
  ready: Promise<void>;
}

export function renderPopup(root: HTMLElement, deps: PopupDeps): PopupHandle {
  let settings: Settings;
  let state: ContentState | null = null;

  const draw = (): void => {
    root.replaceChildren(build(buildPopupModel(state, settings)));
  };

  const reload = async (): Promise<void> => {
    [settings, state] = await Promise.all([deps.settings.load(), deps.client.getState()]);
    draw();
  };

  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-act]");
    if (action) void run(String(action.dataset.act), action.dataset.value);
  });

  root.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (input?.dataset.act === "default") void run("default", input.value);
  });

  async function run(action: string, value?: string): Promise<void> {
    const model = buildPopupModel(state, settings);
    switch (action) {
      case "up":
      case "down":
        state = await deps.client.send({
          type: "command",
          command: action === "up" ? "speed-up" : "speed-down",
        });
        break;
      case "preset":
        state = await deps.client.send({ type: "set-speed", speed: Number(value) });
        break;
      case "reset":
        state = await deps.client.send({ type: "command", command: "reset-default" });
        break;
      case "pin-normal":
        settings = await pin(model, NORMAL_SPEED);
        break;
      case "pin-current":
        settings = await pin(model, model.speed);
        break;
      case "unpin":
        settings = await deps.settings.update((current) => removeRule(current, String(value)));
        break;
      case "default":
        settings = await deps.settings.update((current) => ({
          ...current,
          defaultSpeed: Number(value),
        }));
        break;
      case "options":
        deps.openOptions();
        return;
      default:
        return;
    }
    draw();
  }

  /** The pin buttons only appear when nothing is pinned yet, so this only adds. */
  async function pin(model: PopupModel, speed: number): Promise<Settings> {
    return deps.settings.update((current) => setSpeedForUrl(current, model.url, speed));
  }

  return { ready: reload() };
}

function build(model: PopupModel): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(speedRow(model), presetRow(model), siteRow(model), defaultRow(model));
  if (!model.unavailable) fragment.append(footer(model));
  fragment.append(el("button", { class: "link", "data-act": "options" }, "Settings"));
  return fragment;
}

function speedRow(model: PopupModel): HTMLElement {
  const readout = el("div", { class: "readout" }, formatSpeed(model.speed));
  if (model.overridden) {
    readout.append(
      el("button", { class: "badge", "data-act": "reset" }, `this tab · reset to ${formatSpeed(model.ruleSpeed)}`),
    );
  }

  return el(
    "div",
    { class: "speed-row" },
    el("button", { class: "step", "data-act": "down", "aria-label": "Slower" }, "−"),
    readout,
    el("button", { class: "step", "data-act": "up", "aria-label": "Faster" }, "+"),
  );
}

function presetRow(model: PopupModel): HTMLElement {
  const buttons = model.presets.map((preset) =>
    el(
      "button",
      {
        class: "preset",
        "data-act": "preset",
        "data-value": String(preset),
        "aria-pressed": String(speedsEqual(preset, model.speed)),
      },
      formatSpeed(preset),
    ),
  );
  return el("div", { class: "presets" }, ...buttons);
}

function siteRow(model: PopupModel): HTMLElement {
  if (model.unavailable) {
    return el("p", { class: "note" }, "No media controls on this page.");
  }

  const row = el("div", { class: "site" }, el("span", { class: "host" }, model.host || "this page"));

  if (model.rule) {
    row.append(
      el("span", { class: "pinned" }, `pinned at ${formatSpeed(model.rule.speed)}`),
      el("button", { class: "link", "data-act": "unpin", "data-value": model.rule.id }, "Unpin"),
    );
    return row;
  }

  row.append(
    el("button", { class: "pin", "data-act": "pin-normal" }, "Always 1x here"),
    el("button", { class: "pin", "data-act": "pin-current" }, `Pin ${formatSpeed(model.speed)}`),
  );
  return row;
}

function defaultRow(model: PopupModel): HTMLElement {
  const input = el("input", {
    type: "number",
    id: "default-speed",
    "data-act": "default",
    min: "0.25",
    max: "4",
    step: String(model.step),
    value: String(model.defaultSpeed),
  });
  return el(
    "div",
    { class: "default-row" },
    el("label", { for: "default-speed" }, "Default everywhere"),
    input,
  );
}

function footer(model: PopupModel): HTMLElement {
  const media = model.mediaCount === 1 ? "1 player" : `${model.mediaCount} players`;
  return el(
    "p",
    { class: "footer" },
    el("span", { class: "count" }, media),
    el("span", { class: "tier" }, describeTier(model.tier)),
  );
}

type Attrs = Record<string, string>;

function el(tag: string, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
