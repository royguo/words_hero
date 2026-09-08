/** Shared by the page and the service worker. Only public, immutable media live here. */
export const MEDIA_CACHE = 'kite-course-media-v1';
export const MEDIA_TTL = 7 * 24 * 60 * 60 * 1000;
const mediaPath =
  /^\/assets\/(?:words|lessons|audio)\/[a-zA-Z0-9/_-]+\/([a-f0-9]{64})\.(?:png|jpe?g|webp|mp3)$/;

/** @param {string} path */
export function mediaHash(path) {
  return mediaPath.exec(path)?.[1] || '';
}

/** @param {Response | undefined} response @param {string} path @param {number} [now] */
export function isStoredMedia(response, path, now = Date.now()) {
  if (!response || response.status !== 200) return false;
  const saved = Number(response.headers.get('X-Kite-Cached-At'));
  return (
    saved > 0 &&
    saved <= now &&
    now - saved < MEDIA_TTL &&
    response.headers.get('X-Kite-SHA256') === mediaHash(path) &&
    !!mediaHash(path) &&
    Number(response.headers.get('Content-Length')) > 0
  );
}

/** Remove only expired entries in our own media cache; never touch other app caches.
 * @param {Cache} cache @param {number} [now]
 */
export async function pruneMedia(cache, now = Date.now()) {
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!isStoredMedia(response, new URL(request.url).pathname, now))
      await cache.delete(request);
  }
}

/** Audio players (including Safari) request byte ranges even for short recordings.
 * Slice the complete cached file so that playback never needs a second network fetch.
 * @param {Request} request @param {Response} response
 */
export async function mediaResponse(request, response) {
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('X-Kite-Media-Source', 'browser-cache');
  const range = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  if (
    !range ||
    (ifRange &&
      ifRange !== headers.get('ETag') &&
      ifRange !== headers.get('Last-Modified'))
  )
    return new Response(request.method === 'HEAD' ? null : response.body, {
      headers,
    });
  const size = Number(headers.get('Content-Length'));
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  // Unsupported multi-range requests may legally receive the complete representation.
  if (!match || (!match[1] && !match[2]))
    return new Response(request.method === 'HEAD' ? null : response.body, {
      headers,
    });
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= size
  ) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  const body =
    request.method === 'HEAD'
      ? null
      : (await response.blob()).slice(start, end + 1);
  return new Response(body, { status: 206, headers });
}
