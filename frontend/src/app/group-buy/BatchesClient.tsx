'use client';

import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';
import type { GroupBuySummary } from '@/types';
import { formatPrice } from '@/lib/utils';
import { useMemberSession } from '@/lib/member-session';
import { Countdown, PageHead, PhaseChip } from '@/components/group-buy/portal-ui';
import { rewardOff } from '@/lib/group-buy';

const STEPS = [
  { t: 'Join the batch', d: 'Pick from the batch’s product list while it is open.' },
  { t: 'Pay the tier price', d: 'The more of one product you take, the lower its price. Paid at checkout.' },
  { t: 'The batch closes', d: 'We total every order and place the batch with our supplier.' },
  { t: 'It ships together', d: 'Your order ships when the batch arrives. Follow every step on My orders.' },
];

export function BatchesClient({ batches }: { batches: GroupBuySummary[] }) {
  const { member } = useMemberSession();
  const live = batches.filter((b) => b.phase === 'LIVE');
  const upcoming = batches.filter((b) => b.phase === 'UPCOMING');
  const past = batches.filter((b) => b.phase === 'CLOSED');

  return (
    <div>
      <PageHead eyebrow="Group Buy" title="Buy with the batch.">
        Wholesale tier prices on a set list of products, for a limited time. Orders ship together when the batch arrives.
      </PageHead>

      {live.length === 0 && upcoming.length === 0 && (
        <div className="gbp-panel pad" style={{ marginBottom: 32 }}>
          <div className="h2">No batch is open right now.</div>
          <p className="muted" style={{ marginTop: 6 }}>The next one is announced on the store’s banner. Past batches and their timelines are below.</p>
        </div>
      )}

      <div className="gbp-stack">
        {live.map((b) => <FeaturedBatch key={b.id} b={b} />)}

        {upcoming.length > 0 && (
          <section>
            <div className="label" style={{ marginBottom: 12 }}>Opening soon</div>
            <div className="gbp-cards">{upcoming.map((b) => <BatchCard key={b.id} b={b} />)}</div>
          </section>
        )}

        <section className="gbp-panel">
          <div className="gbp-panel-head"><span className="h3">How a batch works</span>{!member && <Link href="/group-buy/join?next=/group-buy/orders" className="link small">Create an account to follow your orders</Link>}</div>
          <div className="gbp-panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
            {STEPS.map((s, i) => (
              <div key={s.t}>
                <div className="label">Step {i + 1}</div>
                <div className="h3" style={{ marginTop: 8 }}>{s.t}</div>
                <p className="small muted" style={{ marginTop: 4 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {past.length > 0 && (
          <section>
            <div className="label" style={{ marginBottom: 12 }}>Recent batches</div>
            <div className="gbp-cards">{past.map((b) => <BatchCard key={b.id} b={b} />)}</div>
          </section>
        )}
      </div>
    </div>
  );
}

function FeaturedBatch({ b }: { b: GroupBuySummary }) {
  return (
    <section className="gbp-panel gbp-ink" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="gbp-panel-body" style={{ padding: 32 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="label">{b.label}</span>
            <PhaseChip phase={b.phase} />
          </div>
          <h2 className="h1" style={{ marginTop: 14 }}>{b.title}</h2>
          {b.tagline && <p className="lead" style={{ color: '#d4d4d0', marginTop: 8 }}>{b.tagline}</p>}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 18 }} className="small">
            {b.fromPrice != null && <span>From <b className="money">{formatPrice(b.fromPrice)}</b></span>}
            <span>{b.itemCount} product{b.itemCount === 1 ? '' : 's'}</span>
            {b.shipEstimate && <span>Ships {b.shipEstimate}</span>}
            {b.joined != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Users size={14} /> {b.joined} {b.joinedLabel}</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
            <Link href={`/group-buy/${b.slug}`} className="gbp-btn signal lg">See the batch <ArrowRight size={16} className="ir" /></Link>
            {b.reward && <span className="gbp-chip" style={{ alignSelf: 'center', background: '#1c1c1b', color: '#fff' }}>{rewardOff(b.reward)} when you join the list</span>}
          </div>
        </div>
        <div className="gbp-panel-body" style={{ padding: 32, borderLeft: '1px solid #222', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, backgroundImage: b.heroImageUrl ? `linear-gradient(rgba(10,10,10,.72), rgba(10,10,10,.72)), url(${b.heroImageUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
          <div className="label">Closes in</div>
          <Countdown to={b.closesAt} />
          <div className="small muted">{new Date(b.closesAt).toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
        </div>
      </div>
    </section>
  );
}

function BatchCard({ b }: { b: GroupBuySummary }) {
  return (
    <Link href={`/group-buy/${b.slug}`} className="gbp-panel gbp-card">
      <div className="gbp-card-img" style={b.heroImageUrl ? { backgroundImage: `url(${b.heroImageUrl})` } : undefined} />
      <div className="gbp-panel-body" style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="label">{b.label}</span><PhaseChip phase={b.phase} stageLabel={b.stageLabel} /></div>
        <div className="h2">{b.title}</div>
        <div className="small muted">
          {b.phase === 'UPCOMING'
            ? `Opens ${new Date(b.opensAt).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
            : `Closed ${new Date(b.closesAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}`}
          {b.fromPrice != null ? ` · from ${formatPrice(b.fromPrice)}` : ''}
        </div>
      </div>
    </Link>
  );
}
