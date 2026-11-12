/**
 * One promise per key for the life of the process. `next build` renders hundreds of static pages in each worker, and
 * most read the same season files; without this each page reads and parses them again. Callers must not mutate what
 * they get back: it is shared.
 */
export function memo<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const found = new Map<K, Promise<V>>();
  return (key) => {
    let p = found.get(key);
    if (!p) found.set(key, (p = load(key)));
    return p;
  };
}
