'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageCircle, CreditCard, ArrowLeft, CheckCircle } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { createOrder } from '@/lib/api';
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

  if (items.length === 0 && !success) {
    router.push('/cart');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await createOrder({
        ...form,
        paymentMethod,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });

      setSuccess({ orderNumber: result.order.orderNumber, whatsappUrl: result.whatsappUrl });
      clearCart();

      if (paymentMethod === 'WHATSAPP' && result.whatsappUrl) {
        window.open(result.whatsappUrl, '_blank');
      }
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response: { data: { message?: string } } }).response?.data?.message
        : undefined;
      setError(message || 'Failed to place order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Order Placed!</h1>
        <p className="text-text-secondary mb-2">Your order number is:</p>
        <p className="font-display text-xl font-bold mb-6">{success.orderNumber}</p>

        {paymentMethod === 'WHATSAPP' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-green-800">
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

        <div className="flex gap-4 justify-center">
          <Link href="/products"><Button variant="outline">Continue Shopping</Button></Link>
          <Link href="/track"><Button variant="secondary">Track Order</Button></Link>
        </div>
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

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Animate variant="fadeUp" delay={0.05}>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg">Customer Information</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Full Name" id="name" value={form.customerName} onChange={(e) => updateField('customerName', e.target.value)} required />
              <Input label="Phone Number" id="phone" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="012-3456789" required />
            </div>
            <Input label="Email (optional)" id="email" type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} />
          </div>
          </Animate>

          {/* Address */}
          <Animate variant="fadeUp" delay={0.1}>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg">Shipping Address</h2>
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
          <div className="bg-surface rounded-xl border border-border p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg">Payment Method</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setPaymentMethod('WHATSAPP')}
                className={cn(
                  'p-4 rounded-xl border-2 text-left transition-all cursor-pointer',
                  paymentMethod === 'WHATSAPP' ? 'border-primary bg-primary/5' : 'border-border hover:border-border-hover'
                )}
              >
                <MessageCircle className="w-6 h-6 mb-2" />
                <p className="font-medium">WhatsApp</p>
                <p className="text-xs text-text-secondary mt-1">Pay via bank transfer, confirm on WhatsApp</p>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('BILLPLZ')}
                className={cn(
                  'p-4 rounded-xl border-2 text-left transition-all cursor-pointer',
                  paymentMethod === 'BILLPLZ' ? 'border-primary bg-primary/5' : 'border-border hover:border-border-hover'
                )}
              >
                <CreditCard className="w-6 h-6 mb-2" />
                <p className="font-medium">Online Payment</p>
                <p className="text-xs text-text-secondary mt-1">FPX / Credit Card via Billplz</p>
              </button>
            </div>
          </div>
          </Animate>

          {/* Notes */}
          <Animate variant="fadeUp" delay={0.2}>
          <div className="bg-surface rounded-xl border border-border p-6">
            <label htmlFor="notes" className="block text-sm font-medium text-text-secondary mb-1">Order Notes (optional)</label>
            <textarea
              id="notes"
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="Any special instructions..."
            />
          </div>

          </Animate>

          {error && <p className="text-danger text-sm">{error}</p>}
        </div>

        {/* Order Summary */}
        <div className="bg-surface rounded-xl border border-border p-6 h-fit sticky top-24">
          <h3 className="font-display font-semibold text-lg mb-4">Order Summary</h3>
          <div className="space-y-3 mb-4">
            {items.map((item) => (
              <div key={item.productId} className="flex justify-between text-sm">
                <span className="text-text-secondary">{item.name} x{item.quantity}</span>
                <span>{formatPrice(item.price * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-4 mb-6">
            <div className="flex justify-between font-display font-bold text-lg">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? 'Placing Order...' : 'Place Order'}
          </Button>
        </div>
      </form>
    </div>
  );
}
