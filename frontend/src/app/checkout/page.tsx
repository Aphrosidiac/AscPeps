'use client';
import Image from 'next/image';

import { useState, useRef, useEffect } from 'react';
import { includesSummary, lineIdOf, lineUnitPrice } from '@/lib/cart-lines';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageCircle, CreditCard, Bitcoin, Landmark, ChevronDown, ChevronLeft, CheckCircle, X, Tag, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import posthog from 'posthog-js';
import { useCart } from '@/lib/cart';
import { createOrder, getSettings, validateDiscount } from '@/lib/api';
import { formatPrice, cn, normalizePhone } from '@/lib/utils';
import { MALAYSIAN_STATES } from '@/lib/constants';
import { isEastMalaysia, parseEastMalaysiaMinOrder, resolveShippingFeeSen } from '@/lib/shipping-region';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';
import { rememberPendingPayment } from '@/lib/pending-payment';
import { forgetGroupBuyCheckout } from '@/lib/group-buy';
import { rememberTrackedOrder } from '@/lib/tracked-order';
import { preorderLabel, preorderUnits, usePreorder } from '@/lib/preorder';
import { forgetRefCode, useRefCode } from '@/lib/ref-code';
import { getCachedMember, useMemberSession } from '@/lib/member-session';

const FIELD_ORDER = ['email', 'customerName', 'address', 'postcode', 'city', 'state', 'phone'] as const;

/*
 * The checkout is laid out like our other stores' (Teliti, BuatBenda): Shopify's
 * one-page checkout. The form sits on white with floating-label fields, the
 * order sits on a sunk panel running down the right edge, and on phones the
 * order folds into a "Show order summary" bar above the form. The page brings
 * its own logo-only header (SiteChrome leaves /checkout bare): no nav, footer
 * or chat bubble between the customer and paying.
 */

const fieldBox =
  'peer w-full rounded-lg border bg-surface px-3.5 text-[15px] text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary';

/** An input whose label sits inside it and moves up once there is a value. */
function Field({
  id, label, error, prefix, fixedLabel, className, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  /** Text fixed at the start of the box, e.g. "+60". Keeps the label up. */
  prefix?: string;
  fixedLabel?: boolean;
}) {
  const up = fixedLabel || !!prefix;
  return (
    <div className={className}>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3.5 bottom-[9px] text-[15px] text-text-muted">{prefix}</span>}
        <input
          id={id}
          placeholder={props.placeholder ?? ' '}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(fieldBox, 'h-[52px] pt-5 pb-1.5 placeholder:text-text-muted', !up && 'placeholder:text-transparent', error ? 'border-danger' : 'border-border-hover')}
          // Inline so it always beats the box's own padding, whatever order the CSS lands in.
          style={prefix ? { paddingLeft: 46 } : undefined}
          {...props}
        />
        <label
          htmlFor={id}
          className={cn(
            'pointer-events-none absolute left-3.5 top-1.5 text-[11px] leading-4 text-text-muted transition-all duration-100',
            !up && 'peer-placeholder-shown:top-[15px] peer-placeholder-shown:text-[15px] peer-placeholder-shown:leading-5 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:leading-4'
          )}
        >
          {label}
        </label>
      </div>
      {error && <p id={`${id}-error`} className="mt-1.5 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

function SelectField({
  id, label, error, options, className, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { id: string; label: string; error?: string; options: readonly string[] }) {
  return (
    <div className={className}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(fieldBox, 'h-[52px] appearance-none pt-5 pb-1.5 pr-9 cursor-pointer', error ? 'border-danger' : 'border-border-hover', !props.value && 'text-text-muted')}
          {...props}
        >
          <option value="">Select</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <label htmlFor={id} className="pointer-events-none absolute left-3.5 top-1.5 text-[11px] leading-4 text-text-muted">{label}</label>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
      </div>
      {error && <p id={`${id}-error`} className="mt-1.5 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

/** "+ Add …": an optional field that stays out of the way until asked for. */
function Reveal({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="justify-self-start py-1 text-[13px] font-medium text-text-primary underline underline-offset-4 decoration-border-hover hover:decoration-text-primary cursor-pointer">
      + {label}
    </button>
  );
}

/**
 * One payment method: a row in a single bordered list, as on Shopify. The
 * chosen row is tinted and opens its explanation underneath; a method that is
 * off stays listed, greyed, with why.
 */
function PayRow({
  icon: Icon, title, description, note, badge, selected, disabled, ariaLabel, onSelect, children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Replaces the description in danger styling — for a method that is down. */
  note?: string;
  /** e.g. "Soon" for a method that isn't live yet. */
  badge?: string;
  selected: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onSelect: () => void;
  /** What happens next, shown while this method is chosen. */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(selected && 'bg-surface-elevated')}>
      <label
        className={cn(
          'flex items-center gap-3 px-4 py-3.5',
          disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
          selected && 'shadow-[inset_0_0_0_1px_var(--color-primary)] rounded-[inherit]'
        )}
      >
        <input
          type="radio"
          name="payment"
          checked={selected}
          disabled={disabled}
          aria-label={ariaLabel ?? title}
          onChange={() => { if (!disabled) onSelect(); }}
          className="h-[18px] w-[18px] shrink-0 accent-[var(--color-primary)] cursor-pointer disabled:cursor-not-allowed"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-medium text-text-primary">{title}</span>
            {badge && (
              <span className="rounded-full border border-border bg-surface px-2 py-px text-[11px] font-semibold uppercase tracking-wider text-text-muted">{badge}</span>
            )}
          </span>
          <span className={cn('block text-[13px] leading-snug', note ? 'text-danger' : 'text-text-secondary')}>{note ?? description}</span>
        </span>
        <Icon className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
      </label>
      {selected && children && (
        <div className="border-t border-border px-4 py-3.5 text-[13px] leading-relaxed text-text-secondary">{children}</div>
      )}
    </div>
  );
}

function CheckoutHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-center px-4">
        <Link href="/" aria-label="Ascend MY home" className="flex items-center gap-2">
          <Image src="/images/pill-icon.png" alt="" width={30} height={30} />
          <span className="font-display text-xl font-bold tracking-tight">Ascend MY</span>
        </Link>
      </div>
    </header>
  );
}

const makeIdempotencyKey = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const focusFirstError = (errors: Record<string, string>) => {
  const first = FIELD_ORDER.find((f) => errors[f]);
  if (!first) return;
  // Field ids in the JSX: customerName -> name, others match their key.
  const el = document.getElementById(first === 'customerName' ? 'name' : first);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el?.focus({ preventScroll: true });
};

const redirectTo = (url: string) => {
  window.location.href = url;
};

export default function CheckoutPage() {
  const router = useRouter();
  const { items, total, clearCart, hydrated } = useCart();
  const { leadTime: preorderLead } = usePreorder();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ orderNumber: string; whatsappUrl?: string } | null>(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<'WHATSAPP' | 'BILLPLZ' | 'CRYPTO' | 'MANUAL'>('WHATSAPP');
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(false);
  // Independent of onlinePaymentEnabled — crypto is its own method, so the
  // store can run either, both, or neither.
  const [cryptoPaymentEnabled, setCryptoPaymentEnabled] = useState(false);
  const [manualPaymentEnabled, setManualPaymentEnabled] = useState(false);
  const [shippingFee, setShippingFee] = useState('');
  // Minimum order (RM, as stored) to ship to Sabah/Sarawak/Labuan. Empty until
  // settings load, which reads as "no minimum" — the server is the real gate,
  // so a slow settings fetch can't let a short order through, only delay the
  // warning about one.
  const [eastMinOrder, setEastMinOrder] = useState('');
  // Shipping fee (RM, as stored) for those same states. Blank means "same as
  // the standard fee" — not free — matching the server.
  const [eastShippingFee, setEastShippingFee] = useState('');
  // Fiat gateway only. Crypto is never a value here — it's a payment method,
  // not a choice of online gateway.
  const [paymentGateway, setPaymentGateway] = useState<'billplz' | 'toyyibpay'>('billplz');
  // Kept out of `form` because `form` is spread straight into createOrder and
  // this is a separate consent flag, not an order field. Unticked by default:
  // a pre-ticked box is not an opt-in.
  const [subscribe, setSubscribe] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const refCode = useRefCode();
  const [refRefused, setRefRefused] = useState<string | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountError, setDiscountError] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    discountType: string;
    discountValue: number;
    discountAmount: number;
  } | null>(null);
  // Signed in: their email filled in (a sign-up code only works with it).
  const [form, setForm] = useState(() => ({
    customerName: '',
    phone: '',
    email: getCachedMember()?.email ?? '',
    address: '',
    city: '',
    state: '',
    postcode: '',
    notes: '',
  }));
  // Signed in with an unused first-order code: offered like the share-link
  // code, never applied unasked.
  const { member } = useMemberSession();
  const memberCode = member?.signupBonus && !member.signupBonus.used ? member.signupBonus : null;
  // Optional bits Shopify keeps folded away until asked for.
  const [address2, setAddress2] = useState('');
  const [showAddress2, setShowAddress2] = useState(false);
  const [showNote, setShowNote] = useState(false);
  // Phones: the order is a bar above the form until opened.
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Both online methods hand off to a hosted payment page and are confirmed by
  // a gateway rather than by a human, so everything from here on that used to
  // mean "is this BILLPLZ" really means this.
  const isOnlinePayment = paymentMethod === 'BILLPLZ' || paymentMethod === 'CRYPTO';
  // MANUAL also hands off to a hosted page (ours), but is confirmed by a
  // person reviewing an uploaded screenshot — so it redirects like an online
  // method and keeps the cart like one, without being one.
  const isRedirectPayment = isOnlinePayment || paymentMethod === 'MANUAL';

  const submitting = useRef(false);
  // Stable per-attempt key so a network retry of a committed order doesn't
  // create a duplicate (double charge). Reset after a successful submit.
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    getSettings().then((s) => {
      setOnlinePaymentEnabled(s.online_payment_enabled === 'true');
      setCryptoPaymentEnabled(s.crypto_payment_enabled === 'true');
      setManualPaymentEnabled(s.manual_payment_enabled === 'true');
      setShippingFee(s.shipping_fee || '');
      setEastMinOrder(s.east_malaysia_min_order || '');
      setEastShippingFee(s.east_malaysia_shipping_fee || '');
      if (s.payment_gateway === 'billplz' || s.payment_gateway === 'toyyibpay') {
        setPaymentGateway(s.payment_gateway);
      }
    }).catch(() => {});
  }, []);

  // The cart loads from localStorage in an effect, so on a hard refresh the
  // first render always sees an empty cart — redirecting during render would
  // bounce every direct /checkout visit back to /cart. Wait for hydration,
  // and redirect from an effect (not mid-render) per React's rules.
  const shouldRedirect = hydrated && items.length === 0 && !success && !loading;
  useEffect(() => {
    if (shouldRedirect) router.push('/cart');
  }, [shouldRedirect, router]);

  // The link's code is checked before it is offered: nobody should be told
  // they have a code that won't work. If the check itself fails, the offer
  // stands and pressing it gets the real answer.
  useEffect(() => {
    if (!refCode) return;
    validateDiscount(refCode, total, { email: form.email.trim() || undefined })
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 400) setRefRefused(refCode);
        if (status === 404) forgetRefCode();
      });
    // Once per code: the buyer's details are checked again when it is applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refCode]);

  if (!hydrated || shouldRedirect) return null;

  // The API reports errors as { message } for app errors and
  // { error, details: [{ path, message }] } for validation errors — surface
  // the most specific one instead of a generic fallback.
  const apiErrorMessage = (err: unknown): string | undefined => {
    if (!err || typeof err !== 'object' || !('response' in err)) return undefined;
    const data = (err as {
      response?: { data?: { message?: string; error?: string; details?: { path?: string; message?: string }[] } };
    }).response?.data;
    const detail = data?.details?.[0];
    if (detail?.message) return detail.path ? `${detail.path}: ${detail.message}` : detail.message;
    return data?.message || data?.error;
  };

  // The field shows +60, so whatever is typed after it (12-345 6789, or a
  // pasted 012…/+6012…) becomes one full number; the server turns +60… into 0….
  const fullPhone = () => {
    const d = form.phone.replace(/\D/g, '').replace(/^(60|0)/, '');
    return d ? `+60${d}` : '';
  };

  const handleApplyDiscount = async (code = discountCode) => {
    if (!code.trim()) return;
    setDiscountLoading(true);
    setDiscountError('');
    try {
      const result = await validateDiscount(code.trim(), total, {
        email: form.email.trim() || undefined,
        phone: fullPhone() || undefined,
      });
      setAppliedDiscount(result);
      setDiscountCode('');
      posthog.capture('discount_applied', {
        discount_type: result.discountType,
        discount_amount_cents: result.discountAmount,
      });
    } catch (err: unknown) {
      setDiscountError(apiErrorMessage(err) || 'Invalid discount code');
      // A link's code that is refused (paused affiliate, programme off, their
      // own) is not offered again on the next visit.
      if (code === refCode) forgetRefCode();
    } finally {
      setDiscountLoading(false);
    }
  };

  const handleRemoveDiscount = () => {
    setAppliedDiscount(null);
    setDiscountError('');
  };

  const discountAmount = appliedDiscount?.discountAmount ?? 0;

  // Everything below depends on which region the order is going to, so the
  // region is resolved first. Both the fee and the minimum change the moment
  // the customer picks an East Malaysian state.
  const isEastState = isEastMalaysia(form.state);
  // Mirrors createOrder: no shipping only when every line is a noShipping product.
  const shippingInSen = items.length > 0 && items.every((i) => i.noShipping)
    ? 0
    : resolveShippingFeeSen(shippingFee, eastShippingFee, isEastState);
  const orderTotal = Math.max(0, total + shippingInSen - discountAmount);

  // East Malaysia minimum. Measured against `total` — the cart subtotal, before
  // discount and before shipping — because that is exactly what the server
  // measures. Anything else here and the inline warning would disagree with the
  // rejection the customer actually gets.
  const eastMinInSen = parseEastMalaysiaMinOrder(eastMinOrder);
  const eastMinShortfall = isEastState && eastMinInSen > 0 && total < eastMinInSen ? eastMinInSen - total : 0;
  const blockedByEastMin = eastMinShortfall > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const errors = validateForm();
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    submitting.current = true;
    setLoading(true);
    setError('');

    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = makeIdempotencyKey();
      }
      const result = await createOrder({
        ...form,
        phone: fullPhone(),
        address: [form.address.trim(), address2.trim()].filter(Boolean).join(', '),
        // Blank optional email must be omitted — the API rejects "" as an
        // invalid email address.
        email: form.email.trim() || undefined,
        // Only meaningful with an address to attach it to; the server ignores
        // it otherwise, and sending it anyway would be a consent flag with
        // nowhere to land.
        subscribe: subscribe && !!form.email.trim(),
        paymentMethod,
        // What a line includes is the server's to build from the product's
        // settings; the cart only says which OPTIONAL included add-ons were ticked.
        items: items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          addOnIds: (i.includes ?? []).filter((inc) => !inc.required).map((inc) => inc.variantId),
        })),
        idempotencyKey: idempotencyKeyRef.current,
        ...(appliedDiscount ? { discountCode: appliedDiscount.code } : {}),
      });

      // An online order must come back with somewhere to pay. Without one,
      // never show "Order Received": keep the idempotency key so Place Order
      // again reopens this same order and asks the server for its bill.
      if (isRedirectPayment && !result.paymentUrl) {
        setError('We could not open the payment page. Please press Place Order again, or use WhatsApp checkout.');
        setLoading(false);
        submitting.current = false;
        return;
      }

      idempotencyKeyRef.current = null; // success — next order gets a fresh key

      // So "Track Order" — here, on the success page, or days later — opens
      // straight onto this order instead of asking for it.
      rememberTrackedOrder({ orderNumber: result.order.orderNumber, phone: normalizePhone(fullPhone()) });

      // Deliberately NOT called "purchase" and deliberately carries no revenue.
      // At this point the order row exists but nothing has been paid: for
      // BILLPLZ the customer hasn't even reached the gateway yet, and
      // abandoning there is common enough that reconcileStaleOrders exists to
      // restock it. Revenue is emitted server-side from applyPaid() once
      // payment actually clears. Treat this event as "reached the end of the
      // form", i.e. the last funnel step before money.
      posthog.capture('checkout_submitted', {
        order_number: result.order.orderNumber,
        payment_method: paymentMethod,
        item_count: items.length,
        cart_value_cents: orderTotal,
        discount_applied: !!appliedDiscount,
      });

      // Bind this browsing session to the id the server will use when it
      // emits `purchase` for this order. Without it the server-side purchase
      // lands on its own personless id and every funnel breaks at the final
      // step. Must happen before the gateway redirect below.
      posthog.alias(`order_${result.order.orderNumber}`);

      if (isRedirectPayment && result.paymentUrl) {
        // Cart is deliberately NOT cleared here — the customer hasn't paid
        // yet, they've only been handed off to the gateway. Clearing now meant
        // anyone who bailed at the bank page came back to an empty cart and had
        // to rebuild the whole order, which reserves a second lot of stock and
        // can hard-block them on a low-stock variant. The success page clears
        // it once the payment is actually confirmed.
        if (paymentMethod === 'MANUAL') {
          rememberPendingPayment({ url: result.paymentUrl, orderNumber: result.order.orderNumber });
        }
        // An abandoned Group Buy payment from earlier would otherwise make the
        // success page treat this store order as the batch one.
        forgetGroupBuyCheckout();
        redirectTo(result.paymentUrl);
        return;
      }

      clearCart();
      setSuccess({ orderNumber: result.order.orderNumber, whatsappUrl: result.whatsappUrl });

      if (paymentMethod === 'WHATSAPP' && result.whatsappUrl) {
        window.open(result.whatsappUrl, '_blank');
      }
    } catch (err: unknown) {
      // If the API returned field-level validation errors, show them inline
      // on the matching inputs; otherwise fall back to the banner.
      const details = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { details?: { path?: string; message?: string }[] } } }).response?.data?.details
        : undefined;
      const inline: Record<string, string> = {};
      for (const d of details ?? []) {
        if (d.path && d.message && (FIELD_ORDER as readonly string[]).includes(d.path)) inline[d.path] = d.message;
      }
      if (Object.keys(inline).length) {
        setFieldErrors(inline);
        focusFirstError(inline);
      } else {
        setError(apiErrorMessage(err) || 'Failed to place order. Please try again.');
      }
      setLoading(false);
      submitting.current = false;
    }
  };

  if (success) {
    const needsWhatsApp = paymentMethod === 'WHATSAPP' && success.whatsappUrl;

    return (
      <>
      <CheckoutHeader />
      <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <Animate variant="scale" duration={0.5}>
          <CheckCircle className="w-14 h-14 text-success mx-auto mb-3" />
          {/* "Order Received" rather than "Order Placed" — for WhatsApp orders
              nothing has been paid yet, so the heading shouldn't read as done. */}
          <h1 className="font-display text-2xl font-bold mb-2">Order Received!</h1>
          <p className="text-text-secondary mb-1">Your order number is:</p>
          <p className="font-display text-xl font-bold mb-6">{success.orderNumber}</p>

          {needsWhatsApp && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5 mb-6 text-left">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-2">
                One more step — this order isn&apos;t confirmed yet
              </p>
              <p className="text-sm text-amber-900 leading-relaxed mb-4">
                Tap below to send your order to us on WhatsApp. We&apos;ll reply with payment details there — your order won&apos;t be processed until we hear from you.
              </p>
              <a href={success.whatsappUrl} target="_blank" rel="noopener noreferrer" className="block">
                <Button variant="primary" size="lg" className="w-full">
                  <MessageCircle className="w-5 h-5" /> Send Order via WhatsApp
                </Button>
              </a>
              <p className="text-xs text-amber-700 mt-2.5 text-center">Your order details are already filled in — just hit send.</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/products"><Button variant="outline" className="w-full sm:w-auto">Continue Shopping</Button></Link>
            <Link href="/track"><Button variant="secondary" className="w-full sm:w-auto">Track Order</Button></Link>
          </div>
        </Animate>
      </div>
      </>
    );
  }

  const updateField = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear the field's error as soon as the customer starts correcting it.
    setFieldErrors((fe) => (fe[field] ? { ...fe, [field]: '' } : fe));
  };

  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.customerName.trim()) errors.customerName = 'Please enter your full name';
    const phoneDigits = form.phone.replace(/\D/g, '').replace(/^(60|0)/, '');
    if (!form.phone.trim()) errors.phone = 'Please enter your phone number';
    else if (phoneDigits.length < 8 || phoneDigits.length > 10) errors.phone = 'Please enter a valid Malaysian number, e.g. 12-345 6789';
    const email = form.email.trim();
    // The hosted bank-transfer page lives at a /pay/cs_… URL the customer can
    // lose the moment they switch to their banking app. The confirmation
    // email is the one link back to it that survives a closed tab, so it is
    // required there exactly as it is for the card gateways.
    if (isRedirectPayment && !email) errors.email = paymentMethod === 'MANUAL' ? 'Email is required — we send you the link to your payment page' : 'Email is required for online payment';
    else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address';
    if (!form.address.trim()) errors.address = 'Please enter your shipping address';
    if (!form.city.trim()) errors.city = 'Please enter your city';
    if (!form.state) errors.state = 'Please select your state';
    else if (blockedByEastMin) {
      errors.state = `Sabah, Sarawak and Labuan need a minimum order of ${formatPrice(eastMinInSen)}`;
    }
    if (!form.postcode.trim()) errors.postcode = 'Please enter your postcode';
    else if (!/^\d{5}$/.test(form.postcode.trim())) errors.postcode = 'Postcode must be 5 digits';
    return errors;
  };

  const emailLabel =
    paymentMethod === 'CRYPTO'
      // Crypto needs the email for a different reason than the fiat gateways
      // do: a Bitcoin payment can settle after the customer has closed the
      // tab, so email is the only way to tell them it cleared.
      ? 'Email (for your payment confirmation)'
      : paymentMethod === 'MANUAL'
        ? 'Email (we send you a link back to your payment page)'
        : isOnlinePayment ? 'Email' : 'Email (optional)';

  const summary = (
    <>
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={lineIdOf(item)} className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.name} fill sizes="64px" className="object-cover" />
                ) : (
                  <span className="w-full px-1 text-center text-[11px] font-bold leading-tight text-text-muted line-clamp-2 break-words">{item.code}</span>
                )}
              </div>
              <span className="absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold text-white" aria-label={`Quantity ${item.quantity}`}>
                {item.quantity}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug">{item.code}</p>
              <p className="text-[13px] leading-snug text-text-secondary line-clamp-2">{item.name}</p>
              {preorderUnits(item.quantity, item.stock, item.preorder) > 0 && (
                <p className="text-[13px] font-medium text-text-primary">{preorderLabel(item.quantity, item.stock)}</p>
              )}
              {(item.includes ?? []).length > 0 && (
                <p className="text-[12px] leading-snug text-text-muted line-clamp-2">Includes {includesSummary(item)}</p>
              )}
            </div>
            <p className="shrink-0 text-[14px] font-medium tabular-nums">{formatPrice(lineUnitPrice(item) * item.quantity)}</p>
          </li>
        ))}
      </ul>

      {items.some((i) => preorderUnits(i.quantity, i.stock, i.preorder) > 0) && (
        <div className="flex gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">
          <Clock className="h-4 w-4 shrink-0 text-text-primary" aria-hidden="true" />
          <p><span className="font-semibold text-text-primary">Includes a pre-order.</span> Your order ships together in {preorderLead}, when the restock lands.</p>
        </div>
      )}

      {/* Discount code */}
      <div className="border-t border-border pt-5">
        {appliedDiscount ? (
          <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-3 py-2.5">
            <span className="flex items-center gap-2 text-[14px] font-medium text-success">
              <Tag className="h-4 w-4" aria-hidden="true" /> {appliedDiscount.code}
            </span>
            <button type="button" onClick={handleRemoveDiscount} aria-label="Remove discount code" className="rounded p-1 text-success hover:bg-success/20 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div>
            <div className="flex gap-2.5">
              <Field
                id="discount"
                label="Discount code"
                className="flex-1"
                value={discountCode}
                autoComplete="off"
                onChange={(e) => { setDiscountCode(e.target.value); setDiscountError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyDiscount(); } }}
              />
              <button
                type="button"
                onClick={() => handleApplyDiscount()}
                disabled={discountLoading || !discountCode.trim()}
                className="h-[52px] shrink-0 rounded-lg border border-border-hover bg-surface px-5 text-[14px] font-semibold text-text-primary transition-colors enabled:hover:border-primary disabled:text-text-muted disabled:bg-surface-elevated cursor-pointer disabled:cursor-not-allowed"
              >
                {discountLoading ? '…' : 'Apply'}
              </button>
            </div>
            {discountError && <p className="mt-1.5 text-[13px] text-danger">{discountError}</p>}
            {memberCode && !discountCode.trim() && !discountError ? (
              <p className="mt-2 text-[13px] text-text-secondary">
                Your first-order code <span className="font-semibold text-text-primary">{memberCode.code}</span> · {memberCode.percent}% off.{' '}
                <button type="button" className="font-semibold text-text-primary underline underline-offset-2 cursor-pointer" disabled={discountLoading} onClick={() => handleApplyDiscount(memberCode.code)}>
                  Apply it
                </button>
              </p>
            ) : null}
            {/* The code from an affiliate's share link (lib/ref-code.ts): offered, never applied unasked. */}
            {refCode && refCode !== refRefused && !discountCode.trim() && !discountError ? (
              <p className="mt-2 text-[13px] text-text-secondary">
                Code <span className="font-semibold text-text-primary">{refCode}</span> from your link.{' '}
                <button type="button" className="font-semibold text-text-primary underline underline-offset-2 cursor-pointer" disabled={discountLoading} onClick={() => handleApplyDiscount(refCode)}>
                  Apply it
                </button>
              </p>
            ) : null}
          </div>
        )}
      </div>

      <dl className="space-y-2.5 border-t border-border pt-5 text-[14px] tabular-nums">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Subtotal</dt>
          <dd>{formatPrice(total)}</dd>
        </div>
        {appliedDiscount && (
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Discount <span className="text-text-muted">· {appliedDiscount.code}</span></dt>
            <dd className="text-success">−{formatPrice(appliedDiscount.discountAmount)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Shipping{isEastState ? ' · East Malaysia' : ''}</dt>
          {/* Driven by the resolved fee rather than by the raw standard
              setting, so picking an East Malaysian state updates this line
              and the total along with it. */}
          <dd className={shippingInSen === 0 ? 'font-medium text-success' : ''}>{shippingInSen === 0 ? 'Free' : formatPrice(shippingInSen)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 pt-2">
          <dt className="text-[17px] font-semibold">Total</dt>
          <dd className="flex items-baseline gap-1.5">
            <span className="text-[12px] text-text-muted">MYR</span>
            <span className="font-display text-[24px] font-bold">{formatPrice(orderTotal)}</span>
          </dd>
        </div>
      </dl>
    </>
  );

  return (
    <>
    <CheckoutHeader />
    <form onSubmit={handleSubmit} noValidate className="grid lg:min-h-[calc(100svh-65px)] lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
      {/* The order: a bar above the form on phones, the right-hand panel from lg. */}
      <aside aria-labelledby="summary-h" className="border-b border-border bg-surface-elevated lg:order-2 lg:border-b-0 lg:border-l">
        <button
          type="button"
          onClick={() => setSummaryOpen((o) => !o)}
          aria-expanded={summaryOpen}
          aria-controls="order-summary"
          className="flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:hidden cursor-pointer"
        >
          <span className="flex items-center gap-1.5 text-[14px] font-medium text-text-primary">
            {summaryOpen ? 'Hide order summary' : 'Show order summary'}
            <ChevronDown className={cn('h-4 w-4 transition-transform', summaryOpen && 'rotate-180')} aria-hidden="true" />
          </span>
          <span className="font-display text-[18px] font-bold tabular-nums">{formatPrice(orderTotal)}</span>
        </button>
        <div
          id="order-summary"
          className={cn(
            'space-y-5 px-4 pb-6 sm:px-6 lg:sticky lg:top-0 lg:block lg:max-w-[460px] lg:px-10 lg:py-12',
            summaryOpen ? 'block' : 'hidden'
          )}
        >
          <div className="flex items-baseline justify-between">
            <h2 id="summary-h" className="text-[17px] font-semibold">Your order</h2>
            <Link href="/cart" className="text-[13px] font-medium text-text-primary underline underline-offset-4 decoration-border-hover hover:decoration-text-primary">Edit cart</Link>
          </div>
          {summary}
        </div>
      </aside>

      <div className="min-w-0 bg-surface px-4 pt-6 pb-12 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
        <div className="mx-auto grid max-w-[580px] gap-9 lg:mr-0 lg:ml-auto">
          <h1 className="sr-only">Checkout</h1>
          <ol aria-label="Checkout steps" className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
            <li><Link href="/cart" className="font-medium text-text-primary underline underline-offset-4 decoration-border-hover hover:decoration-text-primary">Cart</Link></li>
            <li aria-hidden="true">›</li>
            <li aria-current="step" className="font-semibold text-text-primary">Details</li>
            <li aria-hidden="true">›</li>
            <li>Payment</li>
          </ol>

          <fieldset className="grid gap-3">
            <legend className="mb-3 text-[19px] font-semibold">Contact</legend>
            <Field label={emailLabel} id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} error={fieldErrors.email} required={isRedirectPayment} />
            <p className="text-[13px] text-text-muted">
              {isRedirectPayment ? 'Needed for this payment method: your confirmation and payment link come here.' : 'For your order confirmation.'}
            </p>
            {/* Only offered once there's an address to attach it to, and never
                pre-ticked: a pre-ticked box is not an opt-in. */}
            {form.email.trim() !== '' && (
              <label className="flex cursor-pointer items-start gap-2.5">
                <input type="checkbox" checked={subscribe} onChange={(e) => setSubscribe(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--color-primary)] cursor-pointer" />
                <span className="text-[14px] leading-relaxed text-text-secondary">Email me restock alerts and new batch COAs. No spam, unsubscribe any time.</span>
              </label>
            )}
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-3 text-[19px] font-semibold">Delivery</legend>
            <Field label="Full name" id="name" autoComplete="name" value={form.customerName} onChange={(e) => updateField('customerName', e.target.value)} error={fieldErrors.customerName} required />
            <Field label="Address" id="address" autoComplete="address-line1" value={form.address} onChange={(e) => updateField('address', e.target.value)} error={fieldErrors.address} required />
            {showAddress2 ? (
              <Field label="Apartment, unit, floor (optional)" id="address2" autoComplete="address-line2" value={address2} onChange={(e) => setAddress2(e.target.value)} autoFocus />
            ) : (
              <Reveal label="Add apartment, unit or floor" onClick={() => setShowAddress2(true)} />
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Postcode" id="postcode" autoComplete="postal-code" inputMode="numeric" maxLength={5} value={form.postcode} onChange={(e) => updateField('postcode', e.target.value)} error={fieldErrors.postcode} required />
              <Field label="City" id="city" autoComplete="address-level2" value={form.city} onChange={(e) => updateField('city', e.target.value)} error={fieldErrors.city} required />
              <SelectField label="State" id="state" autoComplete="address-level1" className="col-span-2 sm:col-span-1" options={MALAYSIAN_STATES} value={form.state} onChange={(e) => updateField('state', e.target.value)} error={fieldErrors.state} required />
            </div>

            {/* East Malaysia minimum. Appears the moment the state is picked,
                not on submit — the customer needs to know they have to add
                items while they still have the cart in mind. Framed as how
                much more is needed rather than as a refusal, because that is
                the only version of this message they can act on. */}
            {blockedByEastMin && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="mb-1 text-[13px] font-semibold text-amber-900">Minimum order for {form.state}</p>
                <p className="text-[14px] leading-relaxed text-amber-900">
                  We ship to Sabah, Sarawak and Labuan on orders of{' '}
                  <strong>{formatPrice(eastMinInSen)}</strong> or more. Your cart is at{' '}
                  <strong>{formatPrice(total)}</strong> — add{' '}
                  <strong>{formatPrice(eastMinShortfall)}</strong> more to continue.
                </p>
                <Link href="/products" className="mt-2 inline-block text-[14px] font-medium text-amber-900 underline">Browse products</Link>
              </div>
            )}

            <Field label="Phone" id="phone" type="tel" autoComplete="tel-national" inputMode="tel" prefix="+60" placeholder="12-345 6789" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} error={fieldErrors.phone} required />
            <p className="-mt-1 text-[13px] text-text-muted">Malaysian number, for the courier.</p>

            {showNote ? (
              <div>
                <div className="relative">
                  <textarea
                    id="notes"
                    rows={3}
                    placeholder=" "
                    autoFocus
                    value={form.notes}
                    onChange={(e) => updateField('notes', e.target.value)}
                    className={cn(fieldBox, 'block resize-y border-border-hover pt-6 pb-2 placeholder:text-transparent')}
                  />
                  <label htmlFor="notes" className="pointer-events-none absolute left-3.5 top-1.5 text-[11px] leading-4 text-text-muted">Note (optional)</label>
                </div>
              </div>
            ) : (
              <Reveal label="Add a note to your order" onClick={() => setShowNote(true)} />
            )}
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-3 text-[19px] font-semibold">Payment</legend>
            <div role="radiogroup" aria-label="Payment method" className="overflow-hidden rounded-lg border border-border-hover divide-y divide-border">
              {manualPaymentEnabled && (
                <PayRow
                  icon={Landmark}
                  title="Bank transfer"
                  description="DuitNow QR or transfer, then upload your receipt"
                  selected={paymentMethod === 'MANUAL'}
                  onSelect={() => { setPaymentMethod('MANUAL'); posthog.capture('payment_method_selected', { method: 'MANUAL', gateway: 'manualpaygate' }); }}
                >
                  You&apos;ll be taken to our payment page with the DuitNow QR and bank details for the exact amount. After paying, upload a screenshot of the confirmation there — your order is confirmed once we&apos;ve checked it, usually within a few hours.
                </PayRow>
              )}
              <PayRow
                icon={MessageCircle}
                title="WhatsApp"
                description="Pay by bank transfer, confirm on WhatsApp"
                selected={paymentMethod === 'WHATSAPP'}
                onSelect={() => { setPaymentMethod('WHATSAPP'); posthog.capture('payment_method_selected', { method: 'WHATSAPP' }); }}
              >
                After you place the order, WhatsApp opens with it filled in. Send it and we reply with the payment details — the order isn&apos;t processed until we hear from you.
              </PayRow>
              <PayRow
                icon={CreditCard}
                title="Online payment"
                description={paymentGateway === 'toyyibpay' ? 'FPX online banking via ToyyibPay' : 'FPX or card via Billplz'}
                note={onlinePaymentEnabled ? undefined : 'Currently unavailable. Please use WhatsApp checkout.'}
                selected={paymentMethod === 'BILLPLZ'}
                disabled={!onlinePaymentEnabled}
                onSelect={() => { setPaymentMethod('BILLPLZ'); posthog.capture('payment_method_selected', { method: 'BILLPLZ', gateway: paymentGateway }); }}
              >
                You&apos;ll pay on {paymentGateway === 'toyyibpay' ? 'ToyyibPay' : 'Billplz'}&apos;s page, then come straight back to your order.
              </PayRow>
              {/* Always listed, even while switched off — announcing that
                  Bitcoin is coming is the point of shipping this early. "Soon"
                  rather than the red "Currently unavailable" Online payment
                  uses: that one means a working method is broken right now,
                  this one has never been live. No mention of Lightning — the
                  BTCPay instance is on-chain only. */}
              <PayRow
                icon={Bitcoin}
                title="Bitcoin"
                description="Pay on-chain in BTC, rate locked at checkout"
                badge={cryptoPaymentEnabled ? undefined : 'Soon'}
                selected={paymentMethod === 'CRYPTO'}
                disabled={!cryptoPaymentEnabled}
                ariaLabel={cryptoPaymentEnabled ? 'Pay with Bitcoin' : 'Bitcoin — coming soon, not yet available'}
                onSelect={() => { setPaymentMethod('CRYPTO'); posthog.capture('payment_method_selected', { method: 'CRYPTO', gateway: 'btcpay' }); }}
              >
                {/* Set expectations before they leave the site: an on-chain
                    payment isn't instant like FPX, and a customer who doesn't
                    know that reads the delay as a failed order. */}
                You&apos;ll send the exact BTC amount on our payment page; the rate is locked while the invoice is open. Your order is confirmed once the transaction is confirmed on-chain — usually a few minutes, occasionally longer — and we&apos;ll email you the moment it clears.
              </PayRow>
            </div>
          </fieldset>

          <div className="grid gap-4">
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-danger">{error}</p>}
            <div className="flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
              <Link href="/cart" className="inline-flex items-center justify-center gap-1 text-[14px] font-medium text-text-secondary hover:text-text-primary">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back to cart
              </Link>
              <Button type="submit" size="lg" className="min-h-[56px] sm:min-w-[220px]" disabled={loading || blockedByEastMin}>
                {loading ? 'Placing order…' : isRedirectPayment ? 'Continue to payment' : 'Place order'}
              </Button>
            </div>
            {/* A disabled button on its own reads as broken: say why, right where the click lands. */}
            {blockedByEastMin && (
              <p className="text-center text-[13px] leading-relaxed text-amber-800 sm:text-right">
                Add {formatPrice(eastMinShortfall)} more to reach the {formatPrice(eastMinInSen)} minimum for {form.state}.
              </p>
            )}
          </div>
        </div>
      </div>
    </form>
    </>
  );
}
