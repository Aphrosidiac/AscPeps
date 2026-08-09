'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageCircle, CreditCard, ArrowLeft, CheckCircle, ShieldCheck, Truck, Lock, X, Tag } from 'lucide-react';
import posthog from 'posthog-js';
import { useCart } from '@/lib/cart';
import { createOrder, getSettings, validateDiscount } from '@/lib/api';
import { formatPrice, cn } from '@/lib/utils';
import { MALAYSIAN_STATES } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Animate } from '@/components/ui/Animate';

const FIELD_ORDER = ['customerName', 'phone', 'email', 'address', 'city', 'state', 'postcode'] as const;

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
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ orderNumber: string; whatsappUrl?: string } | null>(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<'WHATSAPP' | 'BILLPLZ'>('WHATSAPP');
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(false);
  const [shippingFee, setShippingFee] = useState('');
  const [paymentGateway, setPaymentGateway] = useState<'billplz' | 'toyyibpay'>('billplz');
  const [discountCode, setDiscountCode] = useState('');
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountError, setDiscountError] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    discountType: string;
    discountValue: number;
    discountAmount: number;
  } | null>(null);
  const [form, setForm] = useState({
    customerName: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    postcode: '',
    notes: '',
  });

  const submitting = useRef(false);
  // Stable per-attempt key so a network retry of a committed order doesn't
  // create a duplicate (double charge). Reset after a successful submit.
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    getSettings().then((s) => {
      setOnlinePaymentEnabled(s.online_payment_enabled === 'true');
      setShippingFee(s.shipping_fee || '');
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

  const handleApplyDiscount = async () => {
    if (!discountCode.trim()) return;
    setDiscountLoading(true);
    setDiscountError('');
    try {
      const result = await validateDiscount(discountCode.trim(), total);
      setAppliedDiscount(result);
      setDiscountCode('');
      posthog.capture('discount_applied', {
        discount_type: result.discountType,
        discount_amount_cents: result.discountAmount,
      });
    } catch (err: unknown) {
      setDiscountError(apiErrorMessage(err) || 'Invalid discount code');
    } finally {
      setDiscountLoading(false);
    }
  };

  const handleRemoveDiscount = () => {
    setAppliedDiscount(null);
    setDiscountError('');
  };

  const discountAmount = appliedDiscount?.discountAmount ?? 0;
  const shippingParsed = parseFloat(shippingFee);
  const shippingInSen = Number.isFinite(shippingParsed) && shippingParsed > 0 ? Math.round(shippingParsed * 100) : 0;
  const orderTotal = Math.max(0, total + shippingInSen - discountAmount);

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
        // Blank optional email must be omitted — the API rejects "" as an
        // invalid email address.
        email: form.email.trim() || undefined,
        paymentMethod,
        items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        idempotencyKey: idempotencyKeyRef.current,
        ...(appliedDiscount ? { discountCode: appliedDiscount.code } : {}),
      });

      idempotencyKeyRef.current = null; // success — next order gets a fresh key

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

      if (paymentMethod === 'BILLPLZ' && result.paymentUrl) {
        // Cart is deliberately NOT cleared here — the customer hasn't paid
        // yet, they've only been handed off to the gateway. Clearing now meant
        // anyone who bailed at the bank page came back to an empty cart and had
        // to rebuild the whole order, which reserves a second lot of stock and
        // can hard-block them on a low-stock variant. The success page clears
        // it once the payment is actually confirmed.
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
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (!form.phone.trim()) errors.phone = 'Please enter your phone number';
    else if (phoneDigits.length < 9 || phoneDigits.length > 12) errors.phone = 'Please enter a valid phone number, e.g. 012-3456789';
    const email = form.email.trim();
    if (paymentMethod === 'BILLPLZ' && !email) errors.email = 'Email is required for online payment';
    else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address';
    if (!form.address.trim()) errors.address = 'Please enter your shipping address';
    if (!form.city.trim()) errors.city = 'Please enter your city';
    if (!form.state) errors.state = 'Please select your state';
    if (!form.postcode.trim()) errors.postcode = 'Please enter your postcode';
    else if (!/^\d{5}$/.test(form.postcode.trim())) errors.postcode = 'Postcode must be 5 digits';
    return errors;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/cart" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Cart
      </Link>

      <Animate variant="fadeUp" duration={0.5}>
        <h1 className="font-display text-3xl font-bold mb-8">Checkout</h1>
      </Animate>

      <form onSubmit={handleSubmit} noValidate className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-5">
          {/* Customer Info */}
          <Animate variant="fadeUp" delay={0.05}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
              <h2 className="font-display font-semibold text-lg">Customer Information</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Full Name" id="name" value={form.customerName} onChange={(e) => updateField('customerName', e.target.value)} error={fieldErrors.customerName} required />
              <Input label="Phone Number" id="phone" type="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="012-3456789" error={fieldErrors.phone} required />
            </div>
            <Input
              label={paymentMethod === 'BILLPLZ' ? 'Email (required for online payment)' : 'Email (optional)'}
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              error={fieldErrors.email}
              required={paymentMethod === 'BILLPLZ'}
            />
          </div>
          </Animate>

          {/* Address */}
          <Animate variant="fadeUp" delay={0.1}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
              <h2 className="font-display font-semibold text-lg">Shipping Address</h2>
            </div>
            <Input label="Address" id="address" value={form.address} onChange={(e) => updateField('address', e.target.value)} error={fieldErrors.address} required />
            <div className="grid sm:grid-cols-3 gap-4">
              <Input label="City" id="city" value={form.city} onChange={(e) => updateField('city', e.target.value)} error={fieldErrors.city} required />
              <Select
                label="State"
                id="state"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
                options={MALAYSIAN_STATES.map((s) => ({ value: s, label: s }))}
                error={fieldErrors.state}
                required
              />
              <Input label="Postcode" id="postcode" value={form.postcode} onChange={(e) => updateField('postcode', e.target.value)} error={fieldErrors.postcode} required />
            </div>
          </div>
          </Animate>

          {/* Payment */}
          <Animate variant="fadeUp" delay={0.15}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
              <h2 className="font-display font-semibold text-lg">Payment Method</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setPaymentMethod('WHATSAPP'); posthog.capture('payment_method_selected', { method: 'WHATSAPP' }); }}
                className={cn(
                  'p-4 rounded-xl border-2 text-left transition-all cursor-pointer group',
                  paymentMethod === 'WHATSAPP' ? 'border-primary bg-primary/5' : 'border-border hover:border-border-hover'
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', paymentMethod === 'WHATSAPP' ? 'bg-green-100' : 'bg-surface-elevated')}>
                    <MessageCircle className={cn('w-5 h-5', paymentMethod === 'WHATSAPP' ? 'text-green-600' : 'text-text-muted')} />
                  </div>
                  <p className="font-semibold">WhatsApp</p>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">Pay via bank transfer, confirm on WhatsApp</p>
              </button>
              <button
                type="button"
                onClick={() => { if (onlinePaymentEnabled) { setPaymentMethod('BILLPLZ'); posthog.capture('payment_method_selected', { method: 'BILLPLZ', gateway: paymentGateway }); } }}
                disabled={!onlinePaymentEnabled}
                className={cn(
                  'p-4 rounded-xl border-2 text-left transition-all relative',
                  !onlinePaymentEnabled
                    ? 'border-border opacity-50 cursor-not-allowed'
                    : paymentMethod === 'BILLPLZ'
                      ? 'border-primary bg-primary/5 cursor-pointer'
                      : 'border-border hover:border-border-hover cursor-pointer'
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', paymentMethod === 'BILLPLZ' ? 'bg-blue-100' : 'bg-surface-elevated')}>
                    <CreditCard className={cn('w-5 h-5', paymentMethod === 'BILLPLZ' ? 'text-blue-600' : 'text-text-muted')} />
                  </div>
                  <p className="font-semibold">Online Payment</p>
                </div>
                {onlinePaymentEnabled ? (
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {paymentGateway === 'toyyibpay' ? 'FPX via ToyyibPay' : 'FPX / Credit Card via Billplz'}
                  </p>
                ) : (
                  <p className="text-xs text-danger leading-relaxed">Currently unavailable. Please use WhatsApp checkout.</p>
                )}
              </button>
            </div>
          </div>
          </Animate>

          {/* Notes */}
          <Animate variant="fadeUp" delay={0.2}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6">
            <label htmlFor="notes" className="block text-sm font-medium text-text-secondary mb-2">Order Notes (optional)</label>
            <textarea
              id="notes"
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="Any special instructions..."
            />
          </div>
          </Animate>

          {error && <p className="text-danger text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}
        </div>

        {/* Order Summary */}
        <Animate variant="fadeUp" delay={0.1}>
        <div className="h-fit sticky top-24 space-y-4">
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6">
            <h3 className="font-display font-semibold text-lg mb-4">Order Summary</h3>
            <div className="space-y-3 mb-4">
              {items.map((item) => (
                <div key={item.variantId} className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-surface-elevated rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[8px] font-bold text-text-muted">{item.code}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-display font-bold truncate">{item.code}</p>
                    <p className="text-xs text-text-muted truncate">{item.name} &middot; Qty: {item.quantity}</p>
                  </div>
                  <p className="text-sm font-semibold shrink-0">{formatPrice(item.price * item.quantity)}</p>
                </div>
              ))}
            </div>

            {/* Discount Code */}
            <div className="border-t border-border pt-4 mb-4">
              {appliedDiscount ? (
                <div className="flex items-center justify-between bg-success/10 border border-success/30 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-success" />
                    <span className="text-sm font-medium text-success">{appliedDiscount.code}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveDiscount}
                    className="p-0.5 rounded hover:bg-success/20 transition-colors"
                  >
                    <X className="w-4 h-4 text-success" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <Input
                      id="discount"
                      value={discountCode}
                      onChange={(e) => { setDiscountCode(e.target.value); setDiscountError(''); }}
                      placeholder="Discount code"
                      className="flex-1 text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleApplyDiscount}
                      disabled={discountLoading || !discountCode.trim()}
                    >
                      {discountLoading ? '...' : 'Apply'}
                    </Button>
                  </div>
                  {discountError && <p className="text-xs text-danger mt-1.5">{discountError}</p>}
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-2 mb-5">
              <div className="flex justify-between text-sm text-text-secondary">
                <span>Subtotal</span>
                <span>{formatPrice(total)}</span>
              </div>
              {appliedDiscount && (
                <div className="flex justify-between text-sm text-success">
                  <span>Discount</span>
                  <span>-{formatPrice(appliedDiscount.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-text-secondary">
                <span>Shipping</span>
                <span className={!shippingFee || shippingFee === '0' ? 'text-success font-medium' : ''}>
                  {!shippingFee || shippingFee === '0' ? 'Free' : formatPrice(shippingInSen)}
                </span>
              </div>
              <div className="flex justify-between font-display font-bold text-lg pt-2 border-t border-border">
                <span>Total</span>
                <span>{formatPrice(orderTotal)}</span>
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? 'Placing Order...' : 'Place Order'}
            </Button>
          </div>

          {/* Trust Signals */}
          <div className="flex items-center justify-center gap-4 text-text-muted">
            <div className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span className="text-xs">Secure</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="text-xs">Verified</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" />
              <span className="text-xs">{!shippingFee || shippingFee === '0' ? 'Free Shipping' : 'Peninsular Malaysia Shipping'}</span>
            </div>
          </div>
        </div>
        </Animate>
      </form>
    </div>
  );
}
