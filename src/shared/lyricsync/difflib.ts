// Python difflib.SequenceMatcher(None, a, b).ratio(), ported exactly (including the
// "autojunk" rule for b >= 200 elements) so match scores equal the prototype's.

export function seqRatio(aStr: string, bStr: string): number {
  const a = Array.from(aStr), b = Array.from(bStr);
  const la = a.length, lb = b.length;
  if (la + lb === 0) return 1;
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < lb; j++) {
    const arr = b2j.get(b[j]);
    if (arr) arr.push(j); else b2j.set(b[j], [j]);
  }
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [elt, idxs] of Array.from(b2j)) if (idxs.length > ntest) b2j.delete(elt);
  }
  const findLongest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const js = b2j.get(a[i]);
      if (js) {
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };
  let matched = 0;
  const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongest(alo, ahi, blo, bhi);
    if (k) {
      matched += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matched) / (la + lb);
}
