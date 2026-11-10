// Spaces out requests per origin. Each caller reserves the next free slot
// synchronously, so concurrent workers line up instead of firing together.

export function createPoliteness() {
  const nextSlot = new Map();
  return {
    waitMs(origin, minIntervalMs) {
      if (minIntervalMs <= 0) return 0;
      const now = Date.now();
      const slot = Math.max(now, nextSlot.get(origin) ?? 0);
      nextSlot.set(origin, slot + minIntervalMs);
      return slot - now;
    },
  };
}
