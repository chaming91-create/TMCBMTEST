import type { ReplacementHistory } from '../types/replacement';

export function recentHistory(history: ReplacementHistory[]) {
  const dateKey = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';
  const registeredAt = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return history.map((item, index) => ({ item, index })).sort((a, b) =>
    dateKey(b.item.replacementDate).localeCompare(dateKey(a.item.replacementDate)) ||
    registeredAt(b.item.createdAt) - registeredAt(a.item.createdAt) || a.index - b.index,
  ).slice(0, 5).map(({ item }) => item);
}
