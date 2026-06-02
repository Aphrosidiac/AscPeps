'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageCircle, CreditCard, ArrowLeft, CheckCircle, ShieldCheck, Truck, Lock, X, Tag } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { createOrder, getSettings, validateDiscount } from '@/lib/api';
import { formatPrice, cn } from '@/lib/utils';
import { MALAYSIAN_STATES } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Animate } from '@/components/ui/Animate';

export default function CheckoutPage() {
  const router = useRouter();
  const { items, total, clearCart } = useCart();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ orderNumber: string; whatsappUrl?: string } | null>(null);
  const [error, setError] = useState('');
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

  if (items.length === 0 && !success && !loading) {
    router.push('/cart');
    return null;
  }

  const handleApplyDiscount = async () => {
    if (!discountCode.trim()) return;
    setDiscountLoading(true);
    setDiscountError('');
    try {
      const result = await validateDiscount(discountCode.trim(), total);
      setAppliedDiscount(result);
      setDiscountCode('');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response: { data: { message?: string } } }).response?.data?.message
        : undefined;
      setDiscountError(message || 'Invalid discount code');
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
    submitting.current = true;
    setLoading(true);
    setError('');

    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      const result = await createOrder({
        ...form,
        paymentMethod,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        idempotencyKey: idempotencyKeyRef.current,
        ...(appliedDiscount ? { discountCode: appliedDiscount.code } : {}),
      });

      idempotencyKeyRef.current = null; // success — next order gets a fresh key

      if (paymentMethod === 'BILLPLZ' && result.paymentUrl) {
        clearCart();
        window.location.href = result.paymentUrl;
        return;
      }

      clearCart();
      setSuccess({ orderNumber: result.order.orderNumber, whatsappUrl: result.whatsappUrl });

      if (paymentMethod === 'WHATSAPP' && result.whatsappUrl) {
        window.open(result.whatsappUrl, '_blank');
      }
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response: { data: { message?: string } } }).response?.data?.message
        : undefined;
      setError(message || 'Failed to place order. Please try again.');
      setLoading(false);
      submitting.current = false;
    }
  };

  if (success) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <Animate variant="scale" duration={0.5}>
          <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold mb-2">Order Placed!</h1>
          <p className="text-text-secondary mb-2">Your order number is:</p>
          <p className="font-display text-xl font-bold mb-6">{success.orderNumber}</p>

          {paymentMethod === 'WHATSAPP' && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6 text-left">
              <p className="text-sm text-green-800 leading-relaxed">
                A WhatsApp message has been prepared with your order details. Complete the payment via bank transfer and send proof of payment through WhatsApp.
              </p>
              {success.whatsappUrl && (
                <a href={success.whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-3">
                  <Button variant="primary" size="sm">
                    <MessageCircle className="w-4 h-4" /> Open WhatsApp
                  </Button>
                </a>
              )}
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

  const updateField = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/cart" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Cart
      </Link>

      <Animate variant="fadeUp" duration={0.5}>
        <h1 className="font-display text-3xl font-bold mb-8">Checkout</h1>
      </Animate>

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-5">
          {/* Customer Info */}
          <Animate variant="fadeUp" delay={0.05}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
              <h2 className="font-display font-semibold text-lg">Customer Information</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Full Name" id="name" value={form.customerName} onChange={(e) => updateField('customerName', e.target.value)} required />
              <Input label="Phone Number" id="phone" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="012-3456789" required />
            </div>
            <Input label="Email (optional)" id="email" type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} />
          </div>
          </Animate>

          {/* Address */}
          <Animate variant="fadeUp" delay={0.1}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
              <h2 className="font-display font-semibold text-lg">Shipping Address</h2>
            </div>
            <Input label="Address" id="address" value={form.address} onChange={(e) => updateField('address', e.target.value)} required />
            <div className="grid sm:grid-cols-3 gap-4">
              <Input label="City" id="city" value={form.city} onChange={(e) => updateField('city', e.target.value)} required />
              <Select
                label="State"
                id="state"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
                options={MALAYSIAN_STATES.map((s) => ({ value: s, label: s }))}
                required
              />
              <Input label="Postcode" id="postcode" value={form.postcode} onChange={(e) => updateField('postcode', e.target.value)} required />
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
                onClick={() => setPaymentMethod('WHATSAPP')}
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
                onClick={() => onlinePaymentEnabled && setPaymentMethod('BILLPLZ')}
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
                <div key={item.productId} className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-surface-elevated rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[8px] font-bold text-text-muted">{item.code}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-text-muted">Qty: {item.quantity}</p>
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
              <span className="text-xs">{!shippingFee || shippingFee === '0' ? 'Free Shipping' : 'Nationwide Shipping'}</span>
            </div>
          </div>
        </div>
        </Animate>
      </form>
    </div>
  );
}
