/**
 * A set that holds its members weakly but can still be iterated.
 *
 * Content scripts outlive the elements they track: a single-page app can create
 * and discard thousands of media elements without a navigation. Holding them in
 * a plain Set would pin every one of them in memory for the life of the tab.
 */

export interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

export type MakeWeakRef = <T extends object>(target: T) => WeakRefLike<T>;

const defaultMakeRef: MakeWeakRef = (target) => new WeakRef(target);

export class IterableWeakSet<T extends object> {
  /** Insertion-ordered, and pruned lazily whenever the set is walked. */
  private refs: WeakRefLike<T>[] = [];
  private index = new WeakMap<T, WeakRefLike<T>>();

  constructor(private readonly makeRef: MakeWeakRef = defaultMakeRef) {}

  /** True when the value was not already present. */
  add(value: T): boolean {
    if (this.has(value)) return false;
    const ref = this.makeRef(value);
    this.refs.push(ref);
    this.index.set(value, ref);
    return true;
  }

  has(value: T): boolean {
    return this.index.get(value)?.deref() !== undefined;
  }

  delete(value: T): boolean {
    const ref = this.index.get(value);
    if (!ref || ref.deref() === undefined) return false;
    this.index.delete(value);
    this.refs = this.refs.filter((candidate) => candidate !== ref);
    return true;
  }

  clear(): void {
    for (const value of this) this.index.delete(value);
    this.refs = [];
  }

  get size(): number {
    this.prune();
    return this.refs.length;
  }

  forEach(visit: (value: T) => void): void {
    for (const value of this) visit(value);
  }

  *[Symbol.iterator](): IterableIterator<T> {
    let collected = false;
    for (const ref of [...this.refs]) {
      const value = ref.deref();
      if (value === undefined) collected = true;
      else yield value;
    }
    if (collected) this.prune();
  }

  private prune(): void {
    this.refs = this.refs.filter((ref) => ref.deref() !== undefined);
  }
}
