import { describe, expect, it } from "vitest";
import { IterableWeakSet, type WeakRefLike } from "../../src/core/weak-set";

/** A WeakRef stand-in whose target can be released on demand, so "the browser
 *  collected that element" is something a test can actually cause. */
class ControllableRef<T extends object> implements WeakRefLike<T> {
  constructor(private target: T | undefined) {}
  deref(): T | undefined {
    return this.target;
  }
  release(): void {
    this.target = undefined;
  }
}

function controllable() {
  const refs: ControllableRef<object>[] = [];
  const make = <T extends object>(target: T): WeakRefLike<T> => {
    const ref = new ControllableRef<object>(target);
    refs.push(ref);
    return ref as WeakRefLike<T>;
  };
  return { make, refs };
}

describe("IterableWeakSet", () => {
  it("adds, reports membership, and counts", () => {
    const set = new IterableWeakSet<object>();
    const a = {};
    expect(set.add(a)).toBe(true);
    expect(set.has(a)).toBe(true);
    expect(set.size).toBe(1);
  });

  it("reports a repeat add as not new, so callers can dedupe on it", () => {
    const set = new IterableWeakSet<object>();
    const a = {};
    set.add(a);
    expect(set.add(a)).toBe(false);
    expect(set.size).toBe(1);
  });

  it("deletes", () => {
    const set = new IterableWeakSet<object>();
    const a = {};
    set.add(a);
    expect(set.delete(a)).toBe(true);
    expect(set.delete(a)).toBe(false);
    expect(set.has(a)).toBe(false);
  });

  it("iterates in insertion order", () => {
    const set = new IterableWeakSet<{ n: number }>();
    const items = [{ n: 1 }, { n: 2 }, { n: 3 }];
    for (const item of items) set.add(item);
    expect([...set].map((i) => i.n)).toEqual([1, 2, 3]);
  });

  it("forgets entries whose target was collected", () => {
    const { make, refs } = controllable();
    const set = new IterableWeakSet<object>(make);
    const a = {};
    const b = {};
    set.add(a);
    set.add(b);

    refs[0]?.release();
    expect(set.size).toBe(1);
    expect([...set]).toEqual([b]);
  });

  it("skips collected entries while iterating, and prunes as it goes", () => {
    const { make, refs } = controllable();
    const set = new IterableWeakSet<{ n: number }>(make);
    set.add({ n: 1 });
    const live = { n: 2 };
    set.add(live);

    refs[0]?.release();
    expect([...set]).toEqual([live]);
    expect([...set]).toEqual([live]);
  });

  it("stops reporting membership for a collected target", () => {
    const { make, refs } = controllable();
    const set = new IterableWeakSet<object>(make);
    const a = {};
    set.add(a);
    refs[0]?.release();
    expect(set.has(a)).toBe(false);
  });

  it("lets a collected target be added again", () => {
    const { make, refs } = controllable();
    const set = new IterableWeakSet<object>(make);
    const a = {};
    set.add(a);
    refs[0]?.release();
    expect(set.add(a)).toBe(true);
    expect(set.size).toBe(1);
  });

  it("drops everything on clear", () => {
    const set = new IterableWeakSet<object>();
    const a = {};
    set.add(a);
    set.clear();
    expect(set.size).toBe(0);
    expect(set.has(a)).toBe(false);
  });

  it("visits every live entry with forEach", () => {
    const set = new IterableWeakSet<{ n: number }>();
    set.add({ n: 1 });
    set.add({ n: 2 });
    const seen: number[] = [];
    set.forEach((item) => seen.push(item.n));
    expect(seen).toEqual([1, 2]);
  });
});
