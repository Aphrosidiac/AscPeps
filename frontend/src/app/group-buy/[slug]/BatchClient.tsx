'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Check, Minus, Plus, Truck, Users } from 'lucide-react';
import type { GroupBuyDetail, GroupBuyItem } from '@/types';
import { formatPrice } from '@/lib/utils';
import { renderMarkdown } from '@/lib/markdown';
import { basketLines, readBasket, tierRange, unitDescription, unitWord, vialsPerUnit, writeBasket, sortTiers } from '@/lib/group-buy';
import { getGroupBuy } from '@/lib/group-buy-api';
import { useMemberSession } from '@/lib/member-session';
import { Countdown, PageHead, PhaseChip, SignupPanel, Timeline } from '@/components/group-buy/portal-ui';

export function BatchClient({ initial }: { initial: GroupBuyDetail }) {
  const gb = initial;
  const router = useRouter();
  const { member } = useMemberSession();
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setQtys(readBasket(gb.slug)); setLoaded(true); }, [gb.slug]);
  useEffect(() => { if (loaded) writeBasket(gb.slug, qtys); }, [qtys, loaded, gb.slug]);

  const lines = useMemo(() => basketLines(gb.items, qtys), [gb.items, qtys]);
  const chosen = lines.filter((l) => l.qty > 0);
  const subtotal = chosen.reduce((s, l) => s + l.total, 0);
  const storeTotal = chosen.reduce((s, l) => s + l.storeTotal, 0);
  const units = chosen.reduce((s, l) => s + l.qty, 0);
  const shipping = gb.shippingFee ?? gb.storeShippingFee;
  const problems = chosen.filter((l) => l.problem).map((l) => `${l.item.code}: ${l.problem}`);
  if (gb.minOrderAmount != null && chosen.length && subtotal < gb.minOrderAmount) problems.push(`Minimum order is ${formatPrice(gb.minOrderAmount)} — add ${formatPrice(gb.minOrderAmount - subtotal)} more`);
  if (units > gb.maxUnitsPerOrder) problems.push(`Up to ${gb.maxUnitsPerOrder} units per order`);
  const live = gb.phase === 'LIVE';
  const canCheckout = live && chosen.length > 0 && problems.length === 0;

  const setQty = (item: GroupBuyItem, next: number) => {
    let q = Math.max(0, Math.floor(next));
    if (item.maxQty != null) q = Math.min(q, item.maxQty);
    setQtys((prev) => ({ ...prev, [item.variantId]: q }));
  };

  return (
    <div>
      {gb.heroImageUrl && <img src={gb.heroImageUrl} alt="" className="gbp-hero-img" />}
      <PageHead eyebrow={`Group Buy · ${gb.label}`} title={gb.title} back={{ href: '/group-buy', label: 'All batches' }}>
        <PhaseChip phase={gb.phase} stageLabel={gb.stages.find((s) => s.key === gb.stageKey)?.label} />
        {gb.tagline && <span>{gb.tagline}</span>}
      </PageHead>

      <div className="gbp-figs" style={{ marginBottom: 32 }}>
        <div className="gbp-fig">
          <div className="label">{gb.phase === 'UPCOMING' ? 'Opens in' : gb.phase === 'LIVE' ? 'Closes in' : 'Closed'}</div>
          <div style={{ marginTop: 8 }}>
            {gb.phase === 'CLOSED'
              ? <div className="v">{new Date(gb.closesAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}</div>
              : <Countdown to={gb.phase === 'UPCOMING' ? gb.opensAt : gb.closesAt} />}
          </div>
        </div>
        <div className="gbp-fig">
          <div className="label">Ships</div>
          <div className="v" style={{ fontSize: 20 }}>{gb.shipEstimate || 'With the batch'}</div>
          <div className="tiny muted">Once the batch arrives</div>
        </div>
        {gb.joined != null && (
          <div className="gbp-fig">
            <div className="label">Joined</div>
            <div className="v num" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Users size={20} />{gb.joined}</div>
            <div className="tiny muted">{gb.joinedLabel}</div>
          </div>
        )}
        <div className="gbp-fig">
          <div className="label">Shipping</div>
          <div className="v" style={{ fontSize: 20 }}>{shipping ? formatPrice(shipping) : 'Free'}</div>
          <div className="tiny muted">{gb.minOrderAmount ? `Min. order ${formatPrice(gb.minOrderAmount)}` : 'Per order'}</div>
        </div>
      </div>

      <div className="gbp-split">
        <div className="gbp-stack">
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <h2 className="h2">Products</h2>
              <span className="small muted">Each product’s price drops as your quantity of it goes up.</span>
            </div>
            <div className="gbp-items">
              {lines.map((l) => <ItemRow key={l.item.id} line={l} onQty={(q) => setQty(l.item, q)} disabled={!live} />)}
            </div>
          </section>

          {gb.description && (
            <section className="gbp-panel pad">
              <div className="label" style={{ marginBottom: 10 }}>About this batch</div>
              <div className="gbp-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(gb.description) }} />
            </section>
          )}

          <section className="gbp-panel">
            <div className="gbp-panel-head"><span className="h3">Batch timeline</span><span className="small muted">Every buyer is emailed at each step</span></div>
            <div className="gbp-panel-body"><Timeline stages={gb.stages} stageKey={gb.stageKey} /></div>
          </section>
        </div>

        <aside className="gbp-sticky gbp-stack">
          <div className="gbp-panel gbp-ink">
            <div className="gbp-panel-head" style={{ borderColor: '#222' }}><span className="h3">Your batch order</span><span className="small muted">{units} unit{units === 1 ? '' : 's'}</span></div>
            <div className="gbp-panel-body">
              {chosen.length === 0 ? (
                <p className="small muted">{live ? 'Choose quantities to see your price.' : gb.phase === 'UPCOMING' ? 'Orders open when the countdown ends.' : 'This batch has closed.'}</p>
              ) : (
                <>
                  {chosen.map((l) => (
                    <div key={l.item.id} className="gbp-sum-row">
                      <span style={{ minWidth: 0 }}>{l.qty} × {l.item.code}<span className="muted"> {unitWord(l.item, l.qty)}</span></span>
                      <span className="money">{formatPrice(l.total)}</span>
                    </div>
                  ))}
                  <div className="gbp-sum-row" style={{ borderTop: '1px solid #222', marginTop: 8, paddingTop: 12 }}><span className="muted">Subtotal</span><span className="money">{formatPrice(subtotal)}</span></div>
                  <div className="gbp-sum-row"><span className="muted">Shipping</span><span className="money">{shipping ? formatPrice(shipping) : 'Free'}</span></div>
                  {storeTotal > subtotal && <div className="gbp-sum-row"><span className="muted">Vs. store prices</span><span className="money" style={{ color: 'var(--green)' }}>−{formatPrice(storeTotal - subtotal)}</span></div>}
                  <div className="gbp-sum-row total"><span>Total</span><span className="money">{formatPrice(subtotal + shipping)}</span></div>
                  {gb.shippingFee == null && <p className="tiny muted" style={{ marginTop: 4 }}>East Malaysia shipping is worked out at checkout.</p>}
                </>
              )}
              {problems.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  {problems.map((p) => <div key={p} className="gbp-check" style={{ color: '#fca5a5' }}><AlertCircle size={14} />{p}</div>)}
                </div>
              )}
              <button
                type="button"
                className="gbp-btn signal lg block"
                style={{ marginTop: 18 }}
                disabled={!canCheckout}
                onClick={() => router.push(`/group-buy/${gb.slug}/checkout`)}
              >
                Continue to checkout <ArrowRight size={16} className="ir" />
              </button>
              <div style={{ marginTop: 14, display: 'grid', gap: 4 }}>
                <div className="gbp-check muted"><Check size={14} />Paid online at checkout</div>
                <div className="gbp-check muted"><Truck size={14} />Ships with the batch{gb.shipEstimate ? ` · ${gb.shipEstimate}` : ''}</div>
                {!member && <div className="gbp-check muted"><Check size={14} /><span><Link href={`/account/register?next=/group-buy/${gb.slug}`} style={{ color: '#fff', textDecoration: 'underline' }}>Make an account</Link> to follow the timeline for every order. Guests can buy too.</span></div>}
              </div>
            </div>
          </div>

          <SignupPanel slug={gb.slug} reward={gb.reward} closed={gb.phase === 'CLOSED'} />
        </aside>
      </div>

      {chosen.length > 0 && live && (
        <div className="gbp-mobile-cta">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tiny" style={{ color: '#a3a3a0' }}>{units} unit{units === 1 ? '' : 's'}{problems.length ? ` · ${problems[0]}` : ''}</div>
            <div className="money" style={{ fontWeight: 600, fontSize: 17 }}>{formatPrice(subtotal + shipping)}</div>
          </div>
          <button type="button" className="gbp-btn signal" disabled={!canCheckout} onClick={() => router.push(`/group-buy/${gb.slug}/checkout`)}>Checkout <ArrowRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

function ItemRow({ line, onQty, disabled }: { line: ReturnType<typeof basketLines>[number]; onQty: (q: number) => void; disabled: boolean }) {
  const { item, qty, tier, problem, next } = line;
  const tiers = sortTiers(item.tiers);
  const perVial = vialsPerUnit(item);
  const bestVial = Math.round(tiers[tiers.length - 1].price / perVial);
  const [text, setText] = useState(String(qty));
  const [last, setLast] = useState(qty);
  if (qty !== last) { setLast(qty); setText(String(qty)); }

  return (
    <div className={`gbp-item ${qty > 0 ? 'on' : ''}`}>
      <div className="gbp-thumb-img">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : item.code}</div>
      <div style={{ minWidth: 0 }}>
        <div className="gbp-code">{item.code}</div>
        <div className="h3">{item.name}</div>
        <div className="small muted">
          {unitDescription(item)}
          {item.minQty > 1 ? ` · min. ${item.minQty} ${unitWord(item, item.minQty)}` : ''}
          {' · '}Store <span className="strike money">{formatPrice(item.storePrice)}</span>/vial, batch from <b className="money" style={{ color: 'var(--fg)' }}>{formatPrice(bestVial)}</b>/vial
        </div>
        {item.note && <div className="small" style={{ marginTop: 4 }}>{item.note}</div>}
        <div className="gbp-tiers">
          {tiers.map((t) => (
            <span key={t.minQty} className={`gbp-tier ${tier?.minQty === t.minQty ? 'hit' : ''}`}>
              <span className="q">{tierRange(item.tiers, t)} {unitWord(item, 2)}</span>
              <span className="p money">{formatPrice(t.price)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="gbp-right">
        <div className="gbp-step">
          <button type="button" aria-label={`Fewer ${item.code}`} disabled={disabled || qty === 0} onClick={() => onQty(qty <= item.minQty ? 0 : qty - 1)}><Minus size={16} /></button>
          <input
            inputMode="numeric"
            aria-label={`${item.code} quantity`}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => onQty(Number(text) || 0)}
            onKeyDown={(e) => { if (e.key === 'Enter') onQty(Number(text) || 0); }}
          />
          <button type="button" aria-label={`More ${item.code}`} disabled={disabled || (item.maxQty != null && qty >= item.maxQty)} onClick={() => onQty(qty === 0 ? item.minQty : qty + 1)}><Plus size={16} /></button>
        </div>
        <div>
          <div className="money" style={{ fontWeight: 600 }}>{qty > 0 && tier ? formatPrice(line.total) : '—'}</div>
          {problem ? (
            <div className="gbp-hint bad">{problem}</div>
          ) : next ? (
            <div className="gbp-hint up">+{next.more} for {formatPrice(next.tier.price)} each</div>
          ) : qty > 0 && tier ? (
            <div className="gbp-hint muted">{formatPrice(tier.price)} each · best price</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** A draft batch, shown only to a signed-in admin. */
export function DraftPreview({ slug }: { slug: string }) {
  const [gb, setGb] = useState<GroupBuyDetail | null | undefined>(undefined);
  useEffect(() => {
    let token: string | null = null;
    try { token = localStorage.getItem('ascend-admin-token'); } catch { /* private mode */ }
    if (!token) { setGb(null); return; }
    getGroupBuy(slug, token).then(setGb).catch(() => setGb(null));
  }, [slug]);
  if (gb === undefined) return <div className="gbp-skel" style={{ height: 320 }} />;
  if (gb === null) {
    return (
      <div className="gbp-panel pad">
        <div className="h2">This batch isn’t available.</div>
        <p className="muted" style={{ marginTop: 6 }}>It may have been taken down. <Link className="link" href="/group-buy">See current batches</Link>.</p>
      </div>
    );
  }
  return (
    <>
      <div className="gbp-note" style={{ marginBottom: 20 }}><AlertCircle size={16} />Draft preview — customers can’t see this batch until it is published.</div>
      <BatchClient initial={gb} />
    </>
  );
}
