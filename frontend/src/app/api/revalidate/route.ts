import { timingSafeEqual } from 'crypto';
import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// Triggered by the backend (fire-and-forget, see backend/src/utils/revalidate.ts)
// after any admin create/update/delete. Server-side fetches in lib/server-api.ts
// are tagged per content type ('products', 'insights', ...); without this, a
// save is correct in the DB immediately but the storefront keeps serving its
// cached render for up to the fetch's own revalidate window.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-revalidate-secret');
  const expected = process.env.REVALIDATE_SECRET;
  // Constant-time comparison — a plain !== leaks how many leading characters
  // match through response timing. timingSafeEqual requires equal lengths,
  // so guard that first (the length check itself reveals nothing useful).
  const a = Buffer.from(secret ?? '');
  const b = Buffer.from(expected ?? '');
  if (!expected || !secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tags: unknown[] = Array.isArray(body?.tags) && body.tags.length > 0 ? body.tags : ['products'];

  // expire: 0 — immediate expiry (next request is a fresh fetch), not the
  // 'max' stale-while-revalidate profile, which could still serve one more
  // stale response before refreshing in the background.
  for (const tag of tags) {
    if (typeof tag === 'string') revalidateTag(tag, { expire: 0 });
  }

  return NextResponse.json({ revalidated: true, tags });
}
