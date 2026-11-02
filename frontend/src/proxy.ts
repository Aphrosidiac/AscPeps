import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * affiliate.ascendpeptides.my is the same app: its paths are served from
 * app/affiliate (so "/" is the affiliate dashboard, "/orders" its orders).
 * A link written as /affiliate/… still works there — it is sent to the short
 * form. On the store's own host /affiliate/… is served as it is.
 *
 * Local: http://affiliate.localhost:3399 (browsers resolve *.localhost).
 */
export function proxy(request: NextRequest) {
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').toLowerCase();
  if (!host.startsWith('affiliate.')) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === '/affiliate' || pathname.startsWith('/affiliate/')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice('/affiliate'.length) || '/';
    return NextResponse.redirect(url);
  }
  const url = request.nextUrl.clone();
  url.pathname = `/affiliate${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: never the build's assets, the API, uploads or files with an extension.
  matcher: ['/((?!_next/|api/|uploads/|ingest/|.*\\.[a-zA-Z0-9]+$).*)'],
};
