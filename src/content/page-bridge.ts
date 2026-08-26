/**
 * Injecting and talking to the page-world agent.
 *
 * The bridge never assumes injection worked: a page whose Content-Security-Policy
 * refuses extension scripts will silently do nothing, so the agent announces
 * itself and the bridge gives up loudly if that announcement does not arrive.
 * The ladder then stays at the rung below, which is the honest outcome.
 */

import {
  commandEventName,
  dispatchPayload,
  messageEventName,
  readPayload,
  type AgentCommand,
  type AgentMessage,
} from "../page/protocol";
import type { EnforcementTarget } from "./enforcer";

const AGENT_SCRIPT = "page-agent.js";
const DEFAULT_HANDSHAKE_MS = 2_000;

export type BridgeState = "idle" | "injecting" | "ready" | "unavailable";

export interface PageBridgeOptions {
  document: Document;
  /** browser.runtime.getURL, injected so this file never touches browser APIs. */
  getUrl: (path: string) => string;
  key?: string | undefined;
  handshakeMs?: number | undefined;
  setTimer?: ((task: () => void, ms: number) => number) | undefined;
  clearTimer?: ((id: number) => void) | undefined;
  onUnavailable?: ((reason: string) => void) | undefined;
}

export class PageBridge {
  private status: BridgeState = "idle";
  private pending: EnforcementTarget | null = null;
  private timerId: number | null = null;
  private readonly doc: Document;
  private readonly getUrl: (path: string) => string;
  private readonly key: string;
  private readonly handshakeMs: number;
  private readonly setTimer: (task: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;
  private readonly onUnavailable: (reason: string) => void;

  constructor(options: PageBridgeOptions) {
    this.doc = options.document;
    this.getUrl = options.getUrl;
    this.key = options.key ?? randomKey();
    this.handshakeMs = options.handshakeMs ?? DEFAULT_HANDSHAKE_MS;
    this.setTimer = options.setTimer ?? ((task, ms) => globalThis.setTimeout(task, ms) as unknown as number);
    this.clearTimer = options.clearTimer ?? ((id) => globalThis.clearTimeout(id));
    this.onUnavailable = options.onUnavailable ?? (() => {});
  }

  get state(): BridgeState {
    return this.status;
  }

  /** Injects on first use, then keeps the agent's target up to date. */
  activate(target: EnforcementTarget): void {
    this.pending = target;
    if (this.status === "ready") return this.send({ type: "target", ...target });
    if (this.status !== "idle") return;
    this.inject();
  }

  /** Tells the agent to stand down without tearing the injection out. */
  deactivate(): void {
    this.pending = null;
    if (this.status === "ready") this.send({ type: "stop" });
  }

  /** Full teardown: stand the agent down and stop listening for it. */
  dispose(): void {
    this.deactivate();
    this.clearTimeout();
    this.doc.removeEventListener(messageEventName(this.key), this.handleMessage);
  }

  private inject(): void {
    this.status = "injecting";
    this.doc.addEventListener(messageEventName(this.key), this.handleMessage);
    this.timerId = this.setTimer(() => this.fail("the page blocked the agent"), this.handshakeMs);

    const script = this.doc.createElement("script");
    script.dataset.steadyKey = this.key;
    script.addEventListener("error", () => this.fail("the agent script failed to load"));
    script.addEventListener("load", () => script.remove());
    script.src = this.getUrl(AGENT_SCRIPT);
    // documentElement, not head: at document_start there may not be a head yet.
    this.doc.documentElement.append(script);
  }

  private readonly handleMessage = (event: Event): void => {
    const message = readPayload<AgentMessage>(event);
    if (message?.type !== "ready" || this.status === "ready") return;
    this.status = "ready";
    this.clearTimeout();
    if (this.pending) this.send({ type: "target", ...this.pending });
  };

  private send(command: AgentCommand): void {
    dispatchPayload(this.doc, commandEventName(this.key), command);
  }

  private fail(reason: string): void {
    if (this.status === "ready" || this.status === "unavailable") return;
    this.status = "unavailable";
    this.clearTimeout();
    this.doc.removeEventListener(messageEventName(this.key), this.handleMessage);
    this.onUnavailable(reason);
  }

  private clearTimeout(): void {
    if (this.timerId === null) return;
    this.clearTimer(this.timerId);
    this.timerId = null;
  }
}

function randomKey(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}
