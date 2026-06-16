import { useCallback, useEffect, useRef } from "react";

const DEFAULT_CAPACITY = 150;

export function useLruObjectUrlCache(capacity = DEFAULT_CAPACITY) {
  const cacheRef = useRef<Map<string, string>>(new Map());

  const evictOldest = useCallback(() => {
    const cache = cacheRef.current;
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    const url = cache.get(oldest);
    if (url) URL.revokeObjectURL(url);
    cache.delete(oldest);
  }, []);

  const get = useCallback(
    async (key: string, loader: () => Promise<string>) => {
      const cache = cacheRef.current;
      const existing = cache.get(key);
      if (existing) {
        cache.delete(key);
        cache.set(key, existing);
        return existing;
      }
      const url = await loader();
      cache.set(key, url);
      while (cache.size > capacity) evictOldest();
      return url;
    },
    [capacity, evictOldest]
  );

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  return get;
}
