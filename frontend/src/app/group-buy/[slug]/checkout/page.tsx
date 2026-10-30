'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Check, Lock, Tag, X } from 'lucide-react';
import type { GroupBuyDetail } from '@/types';
import { createOrder, getSettings, http } from '@/lib/api';
import { getGroupBuy } from '@/lib/group-buy-api';
import { basketLines, clearBasket, readBasket, rememberGroupBuyCheckout, unitWord } from '@/lib/group-buy';
import { MALAYSIAN_STATES } from '@/lib/constants';
import { isEastMalaysia, resolveShippingFeeSen } from '@/lib/shipping-region';
import { formatPrice, normalizePhone } from '@/lib/utils';
import { rememberTrackedOrder } from '@/lib/tracked-order';
import { rememberPendingPayment } from '@/lib/pending-payment';
import { useMemberSession } from '@/lib/member-session';
import { PageHead } from '@/components/group-buy/portal-ui';

type Method = 'BILLPLZ' | 'MANUAL' | 'WHATSAPP';
const FIELDS = ['customerName', 'phone', 'email', 'address', 'city', 'state', 'postcode'] as const;

/**
 * Group Buy checkout. Same order API as the store (orders are ordinary orders
 * tagged with the batch); the lines are the batch basket, priced by the server
 * from the batch's tiers. Online payment always; bank transfer when the store
 * offers it; WhatsApp only when the batch allows it.
 */
export default function GroupBuyCheckoutPage() {
  const { slug } = useParams<{ slug: string }>();
  const { member } = useMemberSession();
  const [gb, setGb] = useState<GroupBuyDetail | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [qtys, setQtys] = useState<Record<string, number> | null>(null);
  const [form, setForm] = useState({ customerName: '', phone: '', email: '', address: '', city: '', state: '', postcode: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<Method>('BILLPLZ');
  const [code, setCode] = useState('');
  const [discount, setDiscount] = useState<{ code: string; discountAmount: number } | null>(null);
  const [codeError, setCodeError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ orderNumber: string; whatsappUrl?: string } | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    getGroupBuy(slug).then(setGb).catch(() => setError('This batch could not be loaded.'));
    getSettings().then(setSettings).catch(() => {});
    setQtys(readBasket(slug));
  }, [slug]);
  useEffect(() => {
    if (member) setForm((f) => ({ ...f, email: f.email || member.email, customerName: f.customerName || member.displayName }));
  }, [member]);

  const online = settings.online_payment_enabled === 'true';
  const manual = settings.manual_payment_enabled === 'true';
  const methods: { id: Method; title: string; body: string }[] = [
    ...(online ? [{ id: 'BILLPLZ' as const, title: 'Pay online', body: 'FPX online banking, cards and e-wallets.' }] : []),
    ...(manual ? [{ id: 'MANUAL' as const, title: 'Bank transfer / DuitNow QR', body: 'Pay on the next page and upload your receipt.' }] : []),
    ...(gb?.allowWhatsapp ? [{ id: 'WHATSAPP' as const, title: 'Order on WhatsApp', body: 'Send the order to us and pay by transfer.' }] : []),
  ];
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === method)) setMethod(methods[0].id);
  }, [methods.map((m) => m.id).join(), method]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => (gb && qtys ? basketLines(gb.items, qtys).filter((l) => l.qty > 0) : []), [gb, qtys]);
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const east = isEastMalaysia(form.state);
  const shipping = gb?.shippingFee != null ? gb.shippingFee : resolveShippingFeeSen(settings.shipping_fee, settings.east_malaysia_shipping_fee, east);
  const total = Math.max(subtotal + shipping - (discount?.discountAmount ?? 0), 0);
  const invalid = lines.some((l) => l.problem) || (gb?.minOrderAmount != null && subtotal < gb.minOrderAmount);

  if (done) {
    return (
      <div style={{ maxWidth: 620 }}>
        <PageHead eyebrow={`Group Buy · ${gb?.label ?? ''}`} title="Order sent.">
          <span>Order <b className="num">{done.orderNumber}</b> is in {gb?.label}.</span>
        </PageHead>
        <div className="gbp-panel pad gbp-stack">
          <p>Finish the order in the WhatsApp chat that just opened — we confirm the transfer there. It ships with the batch.</p>
          {done.whatsappUrl && <a className="gbp-btn primary" href={done.whatsappUrl} target="_blank" rel="noopener noreferrer">Open WhatsApp again</a>}
          <p className="small muted">Follow it on <Link className="link" href="/group-buy/orders">My orders</Link>{member ? '' : ' (sign in with the email you used)'} or on the <Link className="link" href={`/track?order=${encodeURIComponent(done.orderNumber)}`}>Track page</Link>.</p>
        </div>
      </div>
    );
  }

  if (!gb || !qtys) return error ? <div className="gbp-note bad"><AlertCircle size={16} />{error}</div> : <div className="gbp-skel" style={{ height: 420 }} />;

  if (lines.length === 0) {
    return (
      <div className="gbp-panel pad">
        <div className="h2">Your batch order is empty.</div>
        <p className="muted" style={{ marginTop: 6 }}><Link className="link" href={`/group-buy/${slug}`}>Back to {gb.label}</Link> to choose quantities.</p>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: '' }));
    if (k === 'email') setDiscount(null);
  };

  const applyCode = async () => {
    setCodeError('');
    try {
      const r = await http.post<{ code: string; discountAmount: number }>('/api/v1/orders/validate-discount', {
        code: code.trim(), subtotal, groupBuyId: gb.id, email: form.email.trim() || undefined,
      });
      setDiscount(r.data);
      setCode('');
    } catch (e) {
      setCodeError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'That code doesn’t work here.');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    for (const f of FIELDS) if (!form[f].trim()) errs[f] = 'Required';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Enter a valid email';
    if (form.phone && normalizePhone(form.phone).length < 10) errs.phone = 'Enter a valid phone number';
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`gb-${FIELDS.find((f) => errs[f])}`)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      keyRef.current ??= typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await createOrder({
        ...form,
        email: form.email.trim(),
        notes: form.notes.trim() || undefined,
        paymentMethod: method,
        items: lines.map((l) => ({ variantId: l.item.variantId, quantity: l.qty })),
        idempotencyKey: keyRef.current,
        groupBuyId: gb.id,
        ...(discount ? { discountCode: discount.code } : {}),
      });
      rememberTrackedOrder({ orderNumber: result.order.orderNumber, phone: normalizePhone(form.phone) });
      if (method !== 'WHATSAPP') {
        if (!result.paymentUrl) {
          setError('We could not open the payment page. Press Place order again.');
          setBusy(false);
          return;
        }
        keyRef.current = null;
        // The basket stays until payment is confirmed (the success page clears it).
        rememberGroupBuyCheckout(slug, result.order.orderNumber);
        if (method === 'MANUAL') rememberPendingPayment({ url: result.paymentUrl, orderNumber: result.order.orderNumber });
        window.location.href = result.paymentUrl;
        return;
      }
      keyRef.current = null;
      clearBasket(slug);
      setDone({ orderNumber: result.order.orderNumber, whatsappUrl: result.whatsappUrl });
      if (result.whatsappUrl) window.open(result.whatsappUrl, '_blank');
    } catch (err) {
      const d = (err as { response?: { data?: { error?: string; message?: string; details?: { path?: string; message?: string }[] } } })?.response?.data;
      const inline: Record<string, string> = {};
      for (const x of d?.details ?? []) if (x.path && (FIELDS as readonly string[]).includes(x.path)) inline[x.path] = x.message ?? 'Check this';
      if (Object.keys(inline).length) setErrors(inline);
      setError(d?.error || d?.message || 'Could not place the order. Try again.');
      setBusy(false);
    }
  };

  const field = (k: (typeof FIELDS)[number], label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, full = false) => (
    <div className={`gbp-field ${full ? 'full' : ''}`}>
      <label htmlFor={`gb-${k}`}>{label}</label>
      <input id={`gb-${k}`} className="gbp-input" value={form[k]} onChange={set(k)} aria-invalid={!!errors[k]} {...props} />
      {errors[k] && <span className="gbp-err">{errors[k]}</span>}
    </div>
  );

  return (
    <div>
      <PageHead eyebrow={`Group Buy · ${gb.label} · Checkout`} title="Checkout" back={{ href: `/group-buy/${slug}`, label: `Back to ${gb.label}` }}>
        <span>Paid now, shipped with the batch{gb.shipEstimate ? ` · ${gb.shipEstimate}` : ''}.</span>
      </PageHead>

      <form onSubmit={submit} className="gbp-split" noValidate>
        <div className="gbp-stack">
          {!member && (
            <div className="gbp-note">
              <Check size={16} />
              <span>Buying as a guest is fine. <Link className="link" href={`/account/login?next=/group-buy/${slug}/checkout`}>Sign in</Link> or <Link className="link" href={`/account/register?next=/group-buy/${slug}/checkout`}>create an account</Link> with the same email to follow this order and the batch timeline on My orders.</span>
            </div>
          )}
          <section className="gbp-panel">
            <div className="gbp-panel-head"><span className="h3">Contact</span></div>
            <div className="gbp-panel-body gbp-form">
              {field('customerName', 'Full name', { autoComplete: 'name' }, true)}
              {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
              {field('phone', 'Phone', { type: 'tel', autoComplete: 'tel', placeholder: '012 345 6789' })}
            </div>
          </section>
          <section className="gbp-panel">
            <div className="gbp-panel-head"><span className="h3">Delivery address</span></div>
            <div className="gbp-panel-body gbp-form">
              {field('address', 'Address', { autoComplete: 'street-address' }, true)}
              {field('city', 'City', { autoComplete: 'address-level2' })}
              {field('postcode', 'Postcode', { autoComplete: 'postal-code', inputMode: 'numeric' })}
              <div className="gbp-field full">
                <label htmlFor="gb-state">State</label>
                <select id="gb-state" className="gbp-input" value={form.state} onChange={set('state')} aria-invalid={!!errors.state}>
                  <option value="">Choose a state</option>
                  {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {errors.state && <span className="gbp-err">{errors.state}</span>}
              </div>
              <div className="gbp-field full">
                <label htmlFor="gb-notes">Notes <span className="muted">(optional)</span></label>
                <textarea id="gb-notes" className="gbp-input" value={form.notes} onChange={set('notes')} />
              </div>
            </div>
          </section>
          <section className="gbp-panel">
            <div className="gbp-panel-head"><span className="h3">Payment</span></div>
            <div className="gbp-panel-body" style={{ display: 'grid', gap: 10 }}>
              {methods.length === 0 && <p className="small muted">Online payment is not available right now. Please try again shortly.</p>}
              {methods.map((m) => (
                <button key={m.id} type="button" className="gbp-radio" data-on={method === m.id} onClick={() => setMethod(m.id)} style={{ textAlign: 'left' }}>
                  <span className="o" />
                  <span><span className="h3" style={{ display: 'block' }}>{m.title}</span><span className="small muted">{m.body}</span></span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="gbp-sticky gbp-stack">
          <div className="gbp-panel">
            <div className="gbp-panel-head"><span className="h3">{gb.label}</span><Link href={`/group-buy/${slug}`} className="link small">Edit</Link></div>
            <div className="gbp-panel-body">
              {lines.map((l) => (
                <div key={l.item.id} className="gbp-sum-row" style={{ alignItems: 'flex-start' }}>
                  <span style={{ minWidth: 0 }}>
                    <b>{l.qty} × {l.item.code}</b> <span className="muted">{unitWord(l.item, l.qty)}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{l.item.name} · {formatPrice(l.tier?.price ?? 0)} each</span>
                    {l.problem && <span className="gbp-err" style={{ display: 'block' }}>{l.problem}</span>}
                  </span>
                  <span className="money">{formatPrice(l.total)}</span>
                </div>
              ))}

              <div style={{ margin: '14px 0', paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                {discount ? (
                  <div className="gbp-note good" style={{ justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Tag size={14} />{discount.code}</span>
                    <button type="button" aria-label="Remove code" onClick={() => setDiscount(null)}><X size={14} /></button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="gbp-input" placeholder="Discount code" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(''); }} aria-label="Discount code" />
                    <button type="button" className="gbp-btn ghost" onClick={applyCode} disabled={!code.trim()}>Apply</button>
                  </div>
                )}
                {codeError && <p className="gbp-err" style={{ marginTop: 6 }}>{codeError}</p>}
                {!discount && !form.email && <p className="tiny muted" style={{ marginTop: 6 }}>Sign-up reward codes need the email they were sent to — fill it in first.</p>}
              </div>

              <div className="gbp-sum-row"><span className="muted">Subtotal</span><span className="money">{formatPrice(subtotal)}</span></div>
              {discount && <div className="gbp-sum-row"><span className="muted">Discount</span><span className="money green">−{formatPrice(discount.discountAmount)}</span></div>}
              <div className="gbp-sum-row"><span className="muted">Shipping{east && gb.shippingFee == null ? ' (East Malaysia)' : ''}</span><span className="money">{shipping ? formatPrice(shipping) : 'Free'}</span></div>
              <div className="gbp-sum-row total"><span>Total</span><span className="money">{formatPrice(total)}</span></div>

              {error && <div className="gbp-note bad" style={{ marginTop: 12 }}><AlertCircle size={16} />{error}</div>}
              <button className="gbp-btn primary lg block" style={{ marginTop: 16 }} disabled={busy || invalid || methods.length === 0}>
                {busy ? 'Placing order…' : method === 'WHATSAPP' ? 'Send order on WhatsApp' : `Pay ${formatPrice(total)}`} {!busy && <ArrowRight size={16} className="ir" />}
              </button>
              <p className="tiny muted" style={{ marginTop: 10, display: 'flex', gap: 6 }}><Lock size={13} style={{ flex: 'none', marginTop: 2 }} />Ships with {gb.label} once the batch arrives. For laboratory and research use only.</p>
              {gb.phase !== 'LIVE' && <p className="gbp-err" style={{ marginTop: 8 }}>{gb.phase === 'CLOSED' ? 'This batch has closed.' : 'This batch is not open yet.'}</p>}
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
