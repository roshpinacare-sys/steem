export async function throttledBatch<T, R>(
  items: T[],
  size: number,
  jitterMs: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const results = await Promise.all(chunk.map(fn));
    out.push(...results);
    if (i + size < items.length) {
      const delay = Math.random() * jitterMs;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return out;
}
