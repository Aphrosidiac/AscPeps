'use client';

import { useEffect, useState } from 'react';
import { Save, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetSettings, adminUpdateSettings } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function AdminSettingsPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    adminGetSettings(token)
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError('');
    setSaved(false);

    try {
      const updated = await adminUpdateSettings(token, settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-elevated rounded w-32" />
        <div className="h-48 bg-surface-elevated rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-6">Settings</h1>

      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
        {/* Announcement Bar */}
        <div style={{ animationDelay: `0ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Announcement Bar</h2>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="announcement_enabled"
              checked={settings.announcement_enabled === 'true'}
              onChange={(e) => updateSetting('announcement_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded"
            />
            <label htmlFor="announcement_enabled" className="text-sm font-medium text-text-secondary">
              Show announcement bar on the website
            </label>
          </div>
          <Input
            label="Announcement Text"
            id="announcement_text"
            value={settings.announcement_text || ''}
            onChange={(e) => updateSetting('announcement_text', e.target.value)}
            placeholder="e.g. Free shipping on all orders across Peninsular Malaysia 🇲🇾"
          />
          <p className="text-xs text-text-muted">This text appears in a bar above the navigation on every page.</p>
        </div>

        {/* Homepage Hardsell Section */}
        <div style={{ animationDelay: `45ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Homepage Hardsell Section</h2>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="hardsell_enabled"
              checked={settings.hardsell_enabled === 'true'}
              onChange={(e) => updateSetting('hardsell_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded"
            />
            <label htmlFor="hardsell_enabled" className="text-sm font-medium text-text-secondary">
              Show a promotional section on the homepage, above &quot;Shop by Category&quot;
            </label>
          </div>
          <Input
            label="Product Slug"
            id="hardsell_product_slug"
            value={settings.hardsell_product_slug || ''}
            onChange={(e) => updateSetting('hardsell_product_slug', e.target.value)}
            placeholder="retatrutide"
          />
          <Input
            label="Headline"
            id="hardsell_headline"
            value={settings.hardsell_headline || ''}
            onChange={(e) => updateSetting('hardsell_headline', e.target.value)}
            placeholder="Leave blank to just show the product name"
          />
          <Input
            label="Subheadline"
            id="hardsell_subheadline"
            value={settings.hardsell_subheadline || ''}
            onChange={(e) => updateSetting('hardsell_subheadline', e.target.value)}
            placeholder="Leave blank to omit"
          />
          <p className="text-xs text-text-muted">
            The product slug must match a real, active product (e.g. the URL at /products/retatrutide). Section renders nothing if the slug doesn&apos;t match a product.
          </p>
        </div>

        {/* Homepage Hardsell Section — Slide 2 */}
        <div style={{ animationDelay: `90ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Homepage Hardsell Section — Slide 2</h2>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="hardsell_slide2_enabled"
              checked={settings.hardsell_slide2_enabled === 'true'}
              onChange={(e) => updateSetting('hardsell_slide2_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded"
            />
            <label htmlFor="hardsell_slide2_enabled" className="text-sm font-medium text-text-secondary">
              Add a second slide to the carousel
            </label>
          </div>
          <Input
            label="Product Slug"
            id="hardsell_slide2_product_slug"
            value={settings.hardsell_slide2_product_slug || ''}
            onChange={(e) => updateSetting('hardsell_slide2_product_slug', e.target.value)}
            placeholder="ghk-cu"
          />
          <Input
            label="Headline"
            id="hardsell_slide2_headline"
            value={settings.hardsell_slide2_headline || ''}
            onChange={(e) => updateSetting('hardsell_slide2_headline', e.target.value)}
            placeholder="Leave blank to just show the product name"
          />
          <Input
            label="Subheadline"
            id="hardsell_slide2_subheadline"
            value={settings.hardsell_slide2_subheadline || ''}
            onChange={(e) => updateSetting('hardsell_slide2_subheadline', e.target.value)}
            placeholder="Leave blank to omit"
          />
        </div>

        {/* Online Payment */}
        <div style={{ animationDelay: `135ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Online Payment</h2>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="online_payment_enabled"
              checked={settings.online_payment_enabled === 'true'}
              onChange={(e) => updateSetting('online_payment_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded"
            />
            <label htmlFor="online_payment_enabled" className="text-sm font-medium text-text-secondary">
              Enable online payment at checkout
            </label>
          </div>
          <div>
            <label htmlFor="payment_gateway" className="block text-sm font-medium text-text-secondary mb-1">Payment Gateway</label>
            <select
              id="payment_gateway"
              value={settings.payment_gateway || 'billplz'}
              onChange={(e) => updateSetting('payment_gateway', e.target.value)}
              className="w-full max-w-xs px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="billplz">Billplz (FPX, eWallets, Cards)</option>
              <option value="toyyibpay">ToyyibPay (FPX, Cards)</option>
            </select>
          </div>
          <p className="text-xs text-text-muted">Choose which payment gateway to use for online payments. Make sure the gateway credentials are configured in the server environment variables.</p>
        </div>

        {/* Business Info */}
        <div style={{ animationDelay: `180ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Business Information</h2>
          <Input
            label="Business Name"
            id="business_name"
            value={settings.business_name || ''}
            onChange={(e) => updateSetting('business_name', e.target.value)}
            placeholder="Ascend MY"
          />
          <Input
            label="Tagline"
            id="business_tagline"
            value={settings.business_tagline || ''}
            onChange={(e) => updateSetting('business_tagline', e.target.value)}
            placeholder="Premium Peptides Malaysia"
          />
        </div>

        {/* Receipt / Invoice */}
        <div style={{ animationDelay: `225ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Receipt / Invoice</h2>
          <p className="text-xs text-text-muted">These details appear on customer receipts and PDF invoices.</p>
          <Input
            label="Company Name"
            id="receipt_company_name"
            value={settings.receipt_company_name || ''}
            onChange={(e) => updateSetting('receipt_company_name', e.target.value)}
            placeholder="Ascend Peptides"
          />
          <Input
            label="Registration Number (optional)"
            id="receipt_company_reg"
            value={settings.receipt_company_reg || ''}
            onChange={(e) => updateSetting('receipt_company_reg', e.target.value)}
            placeholder="e.g. SA0012345-X"
          />
          <Input
            label="Company Address"
            id="receipt_address"
            value={settings.receipt_address || ''}
            onChange={(e) => updateSetting('receipt_address', e.target.value)}
            placeholder="e.g. Johor Bahru, Malaysia"
          />
          <Input
            label="Company Phone"
            id="receipt_phone"
            value={settings.receipt_phone || ''}
            onChange={(e) => updateSetting('receipt_phone', e.target.value)}
            placeholder="e.g. 011-6109 2723"
          />
          <Input
            label="Company Email"
            id="receipt_email"
            value={settings.receipt_email || ''}
            onChange={(e) => updateSetting('receipt_email', e.target.value)}
            placeholder="e.g. hello@ascendpeptides.my"
          />
          <Input
            label="Receipt Footer Note"
            id="receipt_footer_note"
            value={settings.receipt_footer_note || ''}
            onChange={(e) => updateSetting('receipt_footer_note', e.target.value)}
            placeholder="All products are for research and laboratory use only."
          />
        </div>

        {/* WhatsApp */}
        <div style={{ animationDelay: `270ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">WhatsApp Configuration</h2>
          <Input
            label="WhatsApp Number"
            id="whatsapp_number"
            value={settings.whatsapp_number || ''}
            onChange={(e) => updateSetting('whatsapp_number', e.target.value)}
            placeholder="601161092723"
            pattern="[0-9]{10,15}"
          />
          <p className="text-xs text-text-muted">
            Use international format without + sign (e.g. 601161092723 for Malaysian number 011-6109 2723). Numbers only, 10-15 digits.
          </p>
        </div>

        {/* Shipping */}
        <div style={{ animationDelay: `300ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Shipping & Payments</h2>
          <Input
            label="Shipping Fee (RM)"
            id="shipping_fee"
            type="number"
            min="0"
            step="0.01"
            value={settings.shipping_fee || ''}
            onChange={(e) => updateSetting('shipping_fee', e.target.value)}
            placeholder="0 for free shipping"
          />
          <Input
            label="Minimum Order (RM)"
            id="minimum_order"
            value={settings.minimum_order || ''}
            onChange={(e) => updateSetting('minimum_order', e.target.value)}
            placeholder="0 for no minimum"
          />
          <Input
            label="Bank Account (for manual transfer)"
            id="bank_account"
            value={settings.bank_account || ''}
            onChange={(e) => updateSetting('bank_account', e.target.value)}
            placeholder="e.g. Maybank 1234567890 (Your Name)"
          />
        </div>

        {/* Marketing email */}
        <div style={{ animationDelay: `345ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Marketing Email</h2>
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="marketing_emails_enabled"
              checked={settings.marketing_emails_enabled === 'true'}
              onChange={(e) => updateSetting('marketing_emails_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded mt-0.5"
            />
            <label htmlFor="marketing_emails_enabled" className="text-sm font-medium text-text-secondary">
              Send welcome emails and campaigns
              <span className="block text-xs font-normal text-text-muted mt-0.5">
                Separate from order emails on purpose — turning this off pauses all newsletters while
                confirmations and receipts keep going out. Needs the Emails switch on as well.
              </span>
            </label>
          </div>
          <Input
            label="Welcome discount (%)"
            id="welcome_discount_percent"
            type="number"
            min="0"
            max="100"
            value={settings.welcome_discount_percent || ''}
            onChange={(e) => updateSetting('welcome_discount_percent', e.target.value)}
            placeholder="0 to send the welcome email without a code"
          />
          <Input
            label="Welcome discount valid for (days)"
            id="welcome_discount_days"
            type="number"
            min="1"
            value={settings.welcome_discount_days || ''}
            onChange={(e) => updateSetting('welcome_discount_days', e.target.value)}
            placeholder="30"
          />
          <p className="text-xs text-text-muted">
            Each subscriber gets their own single-use code, so one leaking can only ever discount one order.
          </p>

          <div className="flex items-start gap-3 pt-2 border-t border-border">
            <input
              type="checkbox"
              id="abandoned_checkout_enabled"
              checked={settings.abandoned_checkout_enabled === 'true'}
              onChange={(e) => updateSetting('abandoned_checkout_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded mt-0.5"
            />
            <label htmlFor="abandoned_checkout_enabled" className="text-sm font-medium text-text-secondary">
              Remind customers who didn&apos;t finish paying
              <span className="block text-xs font-normal text-text-muted mt-0.5">
                One email, ~45 minutes after an unpaid order, with a link back to the still-open payment page.
                Never sent twice, and never after the order is paid or cancelled.
              </span>
            </label>
          </div>
        </div>

        {/* Newsletter popup */}
        <div style={{ animationDelay: `390ms` }} className="row-rise bg-surface rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Newsletter Popup</h2>
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="newsletter_popup_enabled"
              checked={settings.newsletter_popup_enabled === 'true'}
              onChange={(e) => updateSetting('newsletter_popup_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded mt-0.5"
            />
            <label htmlFor="newsletter_popup_enabled" className="text-sm font-medium text-text-secondary">
              Show the signup popup on the storefront
              <span className="block text-xs font-normal text-text-muted mt-0.5">
                Exit intent on desktop, half-page scroll or 15 seconds on mobile. Never on cart, checkout or
                order pages, never twice in a session, and silent for 30 days after someone closes it.
              </span>
            </label>
          </div>
          <Input
            label="Popup heading"
            id="newsletter_popup_heading"
            value={settings.newsletter_popup_heading || ''}
            onChange={(e) => updateSetting('newsletter_popup_heading', e.target.value)}
            placeholder="Reconstitution reference, free"
          />
          <Input
            label="Popup body"
            id="newsletter_popup_body"
            value={settings.newsletter_popup_body || ''}
            onChange={(e) => updateSetting('newsletter_popup_body', e.target.value)}
            placeholder="Dosing calculator, storage and handling guide, and batch COAs."
          />
          <p className="text-xs text-text-muted">
            The discount is deliberately not mentioned here — it arrives in the welcome email, so the storefront
            never trains people to wait for a code.
          </p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving} size="lg">
            {saving ? 'Saving...' : saved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> Save Settings</>}
          </Button>
          {saved && <span className="text-sm text-success font-medium">Settings saved successfully</span>}
        </div>
      </form>
    </div>
  );
}
