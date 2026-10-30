'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, ChevronDown, Copy, Mail, Package, Truck } from 'lucide-react';
import { getMyGroupBuys, type MyOrder, type MySignup } from '@/lib/group-buy-api';
import { useMemberSession } from '@/lib/member-session';
import { groupOrderItems } from '@/lib/order-lines';
import { formatPrice } from '@/lib/utils';
import { rewardOff } from '@/lib/group-buy';
import { PageHead, Timeline } from '@/components/group-buy/portal-ui';

type View = 'group' | 'store';

/**
 * A member's orders. Group Buy orders carry their batch's timeline; store
 * orders show where they are. Matched by the member's confirmed email, so a
 * guest order placed with the same address shows up here too.
 */
export default function MyOrdersPage() {
  const { member, ready } = useMemberSession();
  const [data, setData] = useState<{ verified: boolean; orders: MyOrder[]; signups: MySignup[] } | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('group');

  useEffect(() => {
    if (!member) return;
    getMyGroupBuys().then(setData).catch(() => setError('Your orders could not be loaded. Try again shortly.'));
  }, [member]);

  if (!ready) return <div className="gbp-skel" style={{ height: 320 }} />;

  if (!member) {
    return (
      <div>
        <PageHead eyebrow="Group Buy" title="My orders">Every batch order, its timeline and your reward codes in one place.</PageHead>
        <div className="gbp-split">
          <div className="gbp-panel pad gbp-stack">
            <div className="h2">Sign in to see your orders.</div>
            <p className="muted">Use the email you ordered with. Orders placed as a guest with that email show up here too.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href="/account/login?next=/group-buy/orders" className="gbp-btn primary">Sign in</Link>
              <Link href="/account/register?next=/group-buy/orders" className="gbp-btn ghost">Create an account</Link>
            </div>
          </div>
          <div className="gbp-panel pad">
            <div className="label" style={{ marginBottom: 8 }}>No account?</div>
            <p className="small muted">Look up one order with its number and your phone number.</p>
            <Link href="/track" className="gbp-btn ghost sm" style={{ marginTop: 14 }}>Track an order <ArrowRight size={14} className="ir" /></Link>
          </div>
        </div>
      </div>
    );
  }

  const group = data?.orders.filter((o) => o.groupBuy) ?? [];
  const store = data?.orders.filter((o) => !o.groupBuy) ?? [];
  const openGroup = group.filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED');
  const shown = view === 'group' ? group : store;

  return (
    <div>
      <PageHead eyebrow="Group Buy" title="My orders" actions={
        <div className="gbp-seg" role="group" aria-label="Which orders">
          <button type="button" aria-pressed={view === 'group'} onClick={() => setView('group')}>Group Buy ({group.length})</button>
          <button type="button" aria-pressed={view === 'store'} onClick={() => setView('store')}>Store ({store.length})</button>
        </div>
      }>
        Signed in as {member.email}
      </PageHead>

      {error && <div className="gbp-note bad" style={{ marginBottom: 24 }}><AlertCircle size={16} />{error}</div>}

      {data && !data.verified && (
        <div className="gbp-note" style={{ marginBottom: 24 }}>
          <Mail size={16} />
          <span>Confirm your email to see your orders — we only show orders to the person who owns the inbox. <Link className="link" href="/account">Resend the confirmation</Link></span>
        </div>
      )}

      <div className="gbp-split">
        <div className="gbp-stack">
          {data === null && !error && [0, 1].map((i) => <div key={i} className="gbp-skel" style={{ height: 160 }} />)}
          {data && shown.length === 0 && data.verified && (
            <div className="gbp-panel pad">
              <div className="h2">{view === 'group' ? 'No Group Buy orders yet.' : 'No store orders yet.'}</div>
              <p className="muted" style={{ marginTop: 6 }}>
                {view === 'group' ? <>See what’s open on <Link className="link" href="/group-buy">Batches</Link>.</> : <>Browse the <Link className="link" href="/products">store</Link>.</>}
              </p>
            </div>
          )}
          {shown.map((o, i) => <OrderCard key={o.id} order={o} defaultOpen={i === 0 && view === 'group'} />)}
        </div>

        <aside className="gbp-sticky gbp-stack">
          {data?.verified && (
            <div className="gbp-figs">
              <div className="gbp-fig"><div className="label">Open batch orders</div><div className="v num">{openGroup.length}</div></div>
              <div className="gbp-fig"><div className="label">Batches joined</div><div className="v num">{new Set([...group.map((o) => o.groupBuy!.id), ...(data.signups.map((s) => s.groupBuy.id))]).size}</div></div>
            </div>
          )}
          <div className="gbp-panel">
            <div className="gbp-panel-head"><span className="h3">Your lists and rewards</span></div>
            <div className="gbp-panel-body" style={{ display: 'grid', gap: 14 }}>
              {(data?.signups ?? []).length === 0 && <p className="small muted">Join a batch’s list to get updates and any sign-up reward.</p>}
              {(data?.signups ?? []).map((s) => <SignupRow key={s.id} s={s} />)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const PAY_CHIP: Record<string, { cls: string; label: string }> = {
  PAID: { cls: 'good', label: 'Paid' },
  UNPAID: { cls: 'warn', label: 'Awaiting payment' },
  FAILED: { cls: 'bad', label: 'Payment failed' },
  REFUNDED: { cls: 'line', label: 'Refunded' },
};

function OrderCard({ order, defaultOpen }: { order: MyOrder; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const gb = order.groupBuy;
  const pay = PAY_CHIP[order.paymentStatus] ?? { cls: 'line', label: order.paymentStatus };
  const { lines } = groupOrderItems(order.items);
  const stage = gb?.stages.find((s) => s.key === gb.stageKey);
  const cancelled = order.status === 'CANCELLED';
  const shipped = order.status === 'SHIPPED' || order.status === 'DELIVERED';
  // Once the order itself has shipped, its own state outranks the batch's.
  const stageKey = gb
    ? order.status === 'DELIVERED' && gb.stages.some((s) => s.key === 'delivered') ? 'delivered'
      : order.status === 'SHIPPED' && gb.stages.some((s) => s.key === 'shipped') ? 'shipped'
      : gb.stageKey
    : '';

  return (
    <section className="gbp-panel">
      <button type="button" className="gbp-panel-head" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span style={{ minWidth: 0, display: 'grid', gap: 4 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b className="num">{order.orderNumber}</b>
            {gb && <span className="label">{gb.label}</span>}
          </span>
          <span className="small muted">{new Date(order.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })} · {formatPrice(order.total)}</span>
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {cancelled ? <span className="gbp-chip bad">Cancelled</span> : <span className={`gbp-chip ${pay.cls}`}>{pay.label}</span>}
          {gb && !cancelled && stage && <span className={`gbp-chip ${shipped ? 'good' : 'info'}`}><span className="d" />{shipped ? (order.status === 'DELIVERED' ? 'Delivered' : 'Shipped') : stage.label}</span>}
          {!gb && order.isPreorder && !shipped && !cancelled && <span className="gbp-chip warn">Pre-order</span>}
          <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} />
        </span>
      </button>
      {open && (
        <div className="gbp-panel-body" style={{ display: 'grid', gap: 24, gridTemplateColumns: gb ? 'repeat(auto-fit, minmax(260px, 1fr))' : undefined }}>
          <div>
            <div className="label" style={{ marginBottom: 10 }}>Items</div>
            {lines.map(({ item }) => {
              const kits = item.packSize && item.packSize > 1 ? item.quantity / item.packSize : null;
              return (
                <div key={item.id} className="gbp-sum-row">
                  <span style={{ minWidth: 0 }}>
                    {kits ? `${kits} kit${kits === 1 ? '' : 's'}` : `${item.quantity} ×`} {item.variant.product.name}{item.variant.size ? ` ${item.variant.size}` : ''}
                    {kits && <span className="tiny muted"> · {item.quantity} vials</span>}
                  </span>
                  <span className="money">{formatPrice(item.unitPrice * item.quantity)}</span>
                </div>
              );
            })}
            <div className="gbp-sum-row" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10 }}><span className="muted">Shipping</span><span className="money">{order.shippingFee ? formatPrice(order.shippingFee) : 'Free'}</span></div>
            {order.discountAmount > 0 && <div className="gbp-sum-row"><span className="muted">Discount</span><span className="money green">−{formatPrice(order.discountAmount)}</span></div>}
            <div className="gbp-sum-row total"><span>Total</span><span className="money">{formatPrice(order.total)}</span></div>
            {order.tracking && (
              <div className="gbp-note" style={{ marginTop: 14 }}>
                <Truck size={16} />
                <span>{order.tracking.courier ?? 'Courier'} · <span className="num">{order.tracking.number}</span>{order.tracking.url && <> · <a className="link" href={order.tracking.url} target="_blank" rel="noopener noreferrer">Track parcel</a></>}</span>
              </div>
            )}
            {order.paymentStatus === 'UNPAID' && !cancelled && (
              <Link className="gbp-btn primary sm" style={{ marginTop: 14 }} href={`/track?order=${encodeURIComponent(order.orderNumber)}`}>Complete payment <ArrowRight size={14} /></Link>
            )}
          </div>
          {gb ? (
            <div>
              <div className="label" style={{ marginBottom: 10 }}>{gb.label} timeline</div>
              {cancelled ? <p className="small muted">This order was cancelled.</p> : <Timeline stages={gb.stages} stageKey={stageKey} compact />}
              <Link href={`/group-buy/${gb.slug}`} className="link small" style={{ display: 'inline-block', marginTop: 4 }}>View {gb.label}</Link>
            </div>
          ) : (
            <Link href={`/track?order=${encodeURIComponent(order.orderNumber)}`} className="link small"><Package size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Full tracking</Link>
          )}
        </div>
      )}
    </section>
  );
}

function SignupRow({ s }: { s: MySignup }) {
  const [copied, setCopied] = useState(false);
  const r = s.reward;
  const expired = !!r?.expiresAt && new Date(r.expiresAt) < new Date();
  return (
    <div style={{ display: 'grid', gap: 6, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
      <Link href={`/group-buy/${s.groupBuy.slug}`} className="h3">{s.groupBuy.label} · {s.groupBuy.title}</Link>
      <span className="tiny muted">{s.groupBuy.phase === 'LIVE' ? 'Open now' : s.groupBuy.phase === 'UPCOMING' ? 'Opening soon' : s.groupBuy.stageLabel ?? 'Closed'}</span>
      {r && (
        <div className="gbp-code-box" style={{ fontSize: 15 }}>
          <span>{r.code}</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--sans)', letterSpacing: 0 }}>
            <span className={`gbp-chip ${r.used ? 'good' : expired || !r.active ? 'line' : 'info'}`}>{r.used ? 'Used' : expired ? 'Expired' : !r.active ? 'Cancelled' : rewardOff({ type: r.type as 'PERCENTAGE' | 'FIXED_AMOUNT', value: r.value })}</span>
            {!r.used && !expired && r.active && (
              <button type="button" aria-label="Copy code" onClick={() => { navigator.clipboard?.writeText(r.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                <Copy size={14} />
              </button>
            )}
          </span>
        </div>
      )}
      {copied && <span className="tiny green">Copied</span>}
    </div>
  );
}
