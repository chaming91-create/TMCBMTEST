import { describe, expect, it } from 'vitest';
import { recentHistory } from '../recentHistory';
import type { ReplacementHistory } from '../../types/replacement';

const row = (replacementId: string, replacementDate?: string, createdAt?: string) => ({ replacementId, replacementDate, createdAt } as ReplacementHistory);

describe('recent replacement history', () => {
  it('selects only five by replacement date, then registration timestamp', () => {
    const source = [row('old', '2025-01-01'), row('same-old', '2026-11-10', '2026-11-10T01:00:00Z'), row('latest', '2026-11-11'), row('same-new', '2026-11-10', '2026-11-10T05:00:00Z'), row('middle', '2026-11-09'), row('fifth', '2026-11-08'), row('sixth', '2026-11-07')];
    const original = source.slice();
    expect(recentHistory(source).map(x => x.replacementId)).toEqual(['latest', 'same-new', 'same-old', 'middle', 'fifth']);
    expect(source).toEqual(original);
  });
  it('retains original ordering for equal or absent registration timestamps', () => {
    expect(recentHistory([row('a', '2026-11-10'), row('b', '2026-11-10', ''), row('c', '2026-11-10', 'invalid')]).map(x => x.replacementId)).toEqual(['a', 'b', 'c']);
    expect(recentHistory([row('a', '2026-11-10', '2026-11-10T01:00:00Z'), row('b', '2026-11-10', '2026-11-10T01:00:00Z')]).map(x => x.replacementId)).toEqual(['a', 'b']);
  });
  it('handles missing dates and serials and returns fewer than five when appropriate', () => {
    expect(recentHistory([])).toEqual([]);
    expect(recentHistory([row('missing'), row('dated', '2026-11-10'), row('invalid', 'invalid')]).map(x => x.replacementId)).toEqual(['dated', 'missing', 'invalid']);
  });
  it('uses actual registration instants across time zones', () => {
    expect(recentHistory([row('earlier', '2026-11-10', '2026-11-10T09:00:00+09:00'), row('later', '2026-11-10', '2026-11-10T01:00:00Z')]).map(x => x.replacementId)).toEqual(['later', 'earlier']);
  });
  it('reflects newly saved history without an additional data source', () => {
    const source = [row('old', '2026-11-01')];
    const saved = row('saved', '2026-11-10');
    expect(recentHistory([...source, saved])[0]).toBe(saved);
  });
});
