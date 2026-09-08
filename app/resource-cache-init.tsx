'use client';
import { useEffect } from 'react';
import { ensureMediaWorker } from '@/lib/course-resources';

export function ResourceCacheInit() {
  useEffect(() => {
    // Activate previously downloaded media on subsequent visits; downloads stay opt-in.
    void ensureMediaWorker().catch(() => {});
  }, []);
  return null;
}
