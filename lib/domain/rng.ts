// Deterministic seeded PRNG (mulberry32) so the demo dataset and hero
// scenario are byte-for-byte reproducible on every run and in tests.

export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  private rand: () => number;

  constructor(seed = 42) {
    this.rand = mulberry32(seed);
  }

  next(): number {
    return this.rand();
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number, decimals = 2): number {
    const v = this.next() * (max - min) + min;
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  weightedPick<T>(entries: [T, number][]): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
}
