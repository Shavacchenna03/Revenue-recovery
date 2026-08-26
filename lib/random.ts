/**
 * Seeded Pseudo-Random Number Generator (PRNG) Utility
 * 
 * Uses Mulberry32 algorithm for fast, deterministic, reproducible pseudo-random numbers.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed >>> 0;
  }

  /**
   * Returns a pseudo-random float in the range [0, 1)
   */
  nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 85), t | 7);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a pseudo-random integer in the range [min, max] inclusive
   */
  nextInt(min: number, max: number): number {
    const minCeil = Math.ceil(min);
    const maxFloor = Math.floor(max);
    return Math.floor(this.nextFloat() * (maxFloor - minCeil + 1)) + minCeil;
  }

  /**
   * Standard Box-Muller transform for Gaussian / Normal distribution N(mean, stddev)
   */
  nextNormal(mean: number = 0, stddev: number = 1): number {
    let u1 = this.nextFloat();
    let u2 = this.nextFloat();
    // Prevent Math.log(0)
    while (u1 === 0) u1 = this.nextFloat();
    while (u2 === 0) u2 = this.nextFloat();
    
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stddev;
  }

  /**
   * Generates a right-skewed log-normal variable
   * e^N(mu, sigma)
   */
  nextLogNormal(mu: number, sigma: number): number {
    const normal = this.nextNormal(mu, sigma);
    return Math.exp(normal);
  }

  /**
   * Selects an item from an array given item weights
   */
  choiceWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length !== weights.length || items.length === 0) {
      throw new Error('Items and weights must be non-empty and have matching length.');
    }
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);
    let randomVal = this.nextFloat() * totalWeight;

    for (let i = 0; i < items.length; i++) {
      const weight = weights[i] ?? 0;
      if (randomVal < weight) {
        const selected = items[i];
        if (selected === undefined) break;
        return selected;
      }
      randomVal -= weight;
    }
    return items[0]!;
  }
}
