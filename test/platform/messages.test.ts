import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  isCommandName,
  parseBackgroundRequest,
  parseContentRequest,
} from "../../src/platform/messages";

describe("isCommandName", () => {
  it("accepts every command the manifest declares", () => {
    for (const command of COMMANDS) expect(isCommandName(command)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCommandName("delete-everything")).toBe(false);
    expect(isCommandName(42)).toBe(false);
    expect(isCommandName(null)).toBe(false);
  });
});

describe("parseContentRequest", () => {
  it("reads a state request", () => {
    expect(parseContentRequest({ type: "get-state" })).toEqual({ type: "get-state" });
  });

  it("reads a command", () => {
    expect(parseContentRequest({ type: "command", command: "speed-up" })).toEqual({
      type: "command",
      command: "speed-up",
    });
  });

  it("reads a speed", () => {
    expect(parseContentRequest({ type: "set-speed", speed: 2 })).toEqual({
      type: "set-speed",
      speed: 2,
    });
  });

  it("ignores anything it does not recognise", () => {
    expect(parseContentRequest(null)).toBeNull();
    expect(parseContentRequest("get-state")).toBeNull();
    expect(parseContentRequest({ type: "nope" })).toBeNull();
    expect(parseContentRequest({ type: "command", command: "nope" })).toBeNull();
    expect(parseContentRequest({ type: "set-speed", speed: "fast" })).toBeNull();
  });
});

describe("parseBackgroundRequest", () => {
  it("reads a speed report", () => {
    expect(parseBackgroundRequest({ type: "speed-changed", speed: 1.5 })).toEqual({
      type: "speed-changed",
      speed: 1.5,
    });
  });

  it("ignores anything else", () => {
    expect(parseBackgroundRequest(null)).toBeNull();
    expect(parseBackgroundRequest({ type: "speed-changed" })).toBeNull();
    expect(parseBackgroundRequest({ type: "other", speed: 1 })).toBeNull();
  });
});
