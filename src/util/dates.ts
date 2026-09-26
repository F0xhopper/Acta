export const isoNow = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export function daysAgo(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}
