// Managed by Acta. Do not edit.
/**
 * A fluid CSS length that grows from `min` px at a 390px viewport to `max` px at 1440px, as a clamp() expression.
 * Used by app/layout.tsx to turn the type and layout scales in src/theme.ts into CSS variables.
 *   fluidPx(32, 56) -> "clamp(32px, 23.06px + 2.29vw, 56px)"
 * A pair with equal values is just that value.
 */
export function fluidPx(min: number, max: number, from = 390, to = 1440): string {
  if (min === max) return `${min}px`;
  const slope = (max - min) / (to - from);
  const intercept = min - slope * from;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `clamp(${Math.min(min, max)}px, ${r(intercept)}px + ${r(slope * 100)}vw, ${Math.max(min, max)}px)`;
}
