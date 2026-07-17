import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// Triggered by the backend (fire-and-forget, see backend/src/utils/revalidate.ts)
// after any admin product create/update/delete. Server-side product fetches
// in lib/server-api.ts are tagged 'products'; without this, a save is correct
// in the DB immediately but the storefront keeps serving its cached render
// for up to the fetch's own revalidate window.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-revalidate-secret');
  if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // expire: 0 — immediate expiry (next request is a fresh fetch), not the
  // 'max' stale-while-revalidate profile, which could still serve one more
  // stale response before refreshing in the background.
  revalidateTag('products', { expire: 0 });

  return NextResponse.json({ revalidated: true });
}
