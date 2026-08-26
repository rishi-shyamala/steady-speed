/**
 * The wire between the content script and the page-world agent.
 *
 * They live in the same document but different JavaScript worlds, so the only
 * thing that crosses is a DOM event carrying a JSON string. Objects would hit
 * Firefox's Xray boundary; strings do not.
 *
 * The channel name carries a per-page nonce. That is not a security boundary —
 * the page can do anything it likes in its own world — it only keeps two
 * instances, or a page that happens to use similar event names, from colliding.
 */

export interface TargetCommand {
  type: "target";
  speed: number;
  preservePitch: boolean;
}

export interface StopCommand {
  type: "stop";
}

export type AgentCommand = TargetCommand | StopCommand;

export interface ReadyMessage {
  type: "ready";
}

export type AgentMessage = ReadyMessage;

export function commandEventName(key: string): string {
  return `steady-cmd-${key}`;
}

export function messageEventName(key: string): string {
  return `steady-msg-${key}`;
}

/** Reads a JSON payload off an event, returning null if it is not usable. */
export function readPayload<T>(event: Event): T | null {
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== "string") return null;
  try {
    return JSON.parse(detail) as T;
  } catch {
    return null;
  }
}

export function dispatchPayload(target: EventTarget, name: string, payload: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) }));
}
