const INDEXNOW_KEY = '6811eafd075ab38fa10bce5c1b89f1cc';
const SITE_HOST = 'ascendpeptides.my';
const SITE_URL = `https://${SITE_HOST}`;

/**
 * Best-effort ping to IndexNow (Bing/Yandex/Naver) when product pages are
 * created, updated, or removed from the catalog. Never awaited by callers
 * on their critical path — a slow or failed IndexNow call must not delay
 * or fail an admin product save. Google doesn't consume IndexNow; this
 * only affects those three engines' crawl scheduling.
 */
export function notifyIndexNow(urls: string[]): void {
  if (urls.length === 0) return;

  fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: SITE_HOST,
      key: INDEXNOW_KEY,
      keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    }),
  }).catch(() => {
    // Best-effort — IndexNow being unreachable is not an application error.
  });
}

export function productUrl(slug: string): string {
  return `${SITE_URL}/products/${slug}`;
}
