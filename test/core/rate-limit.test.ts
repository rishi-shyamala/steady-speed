import { describe, expect, it } from "vitest";
import { SlidingWindow } from "../../src/core/rate-limit";

describe("SlidingWindow", () => {
  it("accepts events up to the limit", () => {
    const window = new SlidingWindow(3, 1000);
    expect(window.record(0)).toBe(true);
    expect(window.record(10)).toBe(true);
    expect(window.record(20)).toBe(true);
  });

  it("reports the event that crosses the limit", () => {
    const window = new SlidingWindow(2, 1000);
    window.record(0);
    window.record(10);
    expect(window.record(20)).toBe(false);
  });

  it("forgets events that fall out of the window", () => {
    const window = new SlidingWindow(2, 1000);
    window.record(0);
    window.record(10);
    expect(window.record(20)).toBe(false);
    expect(window.record(1500)).toBe(true);
    expect(window.count(1500)).toBe(1);
  });

  it("treats an event exactly at the window edge as expired", () => {
    const window = new SlidingWindow(1, 1000);
    window.record(0);
    expect(window.count(1000)).toBe(0);
  });

  it("reports saturation without recording anything", () => {
    const window = new SlidingWindow(1, 1000);
    window.record(0);
    window.record(1);
    expect(window.isSaturated(2)).toBe(true);
    expect(window.isSaturated(2)).toBe(true);
    expect(window.count(2)).toBe(2);
  });

  it("clears on reset", () => {
    const window = new SlidingWindow(1, 1000);
    window.record(0);
    window.record(1);
    window.reset();
    expect(window.count(2)).toBe(0);
    expect(window.isSaturated(2)).toBe(false);
  });
});
