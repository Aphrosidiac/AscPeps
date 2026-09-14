'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetSettings, adminUpdateSettings } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody, Field, TextInput, SelectInput, Affixed, Toggle, TabBar, SaveBar } from '@/components/admin/ui';
import { ManualPaySettings, MANUALPAY_CONFIG_KEY } from './ManualPaySettings';

/**
 * Settings is one flat key/value bag on the server, saved in one PUT. The
 * page groups it into five tabs by what the admin is trying to do; each key
 * belongs to exactly one tab so the tab strip can show where the unsaved
 * edits are. Layout and controls follow the SmoothSail admin (see
 * components/admin/settings-ui.tsx). The save is the whole bag, always, so
 * switching tabs never loses an edit.
 */
type TabId = 'storefront' | 'payments' | 'shipping' | 'business' | 'emails';

const TABS: { id: TabId; label: string; blurb: string; keys: string[] }[] = [
  {
    id: 'storefront',
    label: 'Storefront',
    blurb: 'Announcement bar, homepage promo and the newsletter popup.',
    keys: [
      'announcement_enabled', 'announcement_text',
      'hardsell_enabled', 'hardsell_product_slug', 'hardsell_headline', 'hardsell_subheadline',
      'hardsell_slide2_enabled', 'hardsell_slide2_product_slug', 'hardsell_slide2_headline', 'hardsell_slide2_subheadline',
      'newsletter_popup_enabled', 'newsletter_popup_heading', 'newsletter_popup_body',
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    blurb: 'How customers can pay at checkout. WhatsApp is always on.',
    keys: ['online_payment_enabled', 'payment_gateway', 'crypto_payment_enabled', 'manual_payment_enabled', MANUALPAY_CONFIG_KEY],
  },
  {
    id: 'shipping',
    label: 'Shipping',
    blurb: 'What delivery costs, and the East Malaysia rules.',
    keys: ['shipping_fee', 'east_malaysia_shipping_fee', 'east_malaysia_min_order'],
  },
  {
    id: 'business',
    label: 'Business',
    blurb: 'Store name, WhatsApp number and what appears on receipts.',
    keys: [
      'business_name', 'business_tagline', 'whatsapp_number',
      'receipt_company_name', 'receipt_company_reg', 'receipt_address', 'receipt_phone', 'receipt_email', 'receipt_footer_note',
    ],
  },
  {
    id: 'emails',
    label: 'Emails',
    blurb: 'Welcome discount, campaigns and payment reminders.',
    keys: ['marketing_emails_enabled', 'welcome_discount_percent', 'welcome_discount_days', 'abandoned_checkout_enabled'],
  },
];

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

function tabFromHash(): TabId {
  if (typeof window === 'undefined') return 'storefront';
  const h = window.location.hash.replace(/^#/, '');
  return TAB_IDS.has(h) ? (h as TabId) : 'storefront';
}

export default function AdminSettingsPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({});
  // What the server last gave us — "unsaved changes" is measured against this.
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabId>('storefront');

  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const selectTab = (id: TabId) => {
    setTab(id);
    // replaceState, not location.hash: no scroll jump and no history entry
    // per click, but the URL still deep-links and survives a reload.
    window.history.replaceState(null, '', `#${id}`);
  };

  useEffect(() => {
    if (!token) return;
    adminGetSettings(token)
      .then((s) => {
        setSettings(s);
        setBaseline(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const dirtyKeys = useMemo(
    () => Object.keys(settings).filter((k) => (settings[k] ?? '') !== (baseline[k] ?? '')),
    [settings, baseline]
  );
  const dirtyTabs = useMemo(() => {
    const set = new Set<TabId>();
    for (const t of TABS) if (t.keys.some((k) => dirtyKeys.includes(k))) set.add(t.id);
    return set;
  }, [dirtyKeys]);
  const isDirty = dirtyKeys.length > 0;

  // The old single scroll always had Save in view at the bottom; tabs make
  // it possible to wander off with edits pending, so the browser asks first.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!token || saving || !isDirty) return;
    setSaving(true);
    setError('');
    setJustSaved(false);

    try {
      const updated = await adminUpdateSettings(token, settings);
      setSettings(updated);
      setBaseline(updated);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err: unknown) {
      // Show the server's own reason when it has one. A rejected setting is
      // usually rejected for a specific, actionable reason — "BTCPay is not
      // configured on this server", a numeric bound — and collapsing all of
      // those into "Failed to save settings" leaves the admin re-ticking a
      // box with no idea why it won't stick.
      // The API reports app errors under `error` and validation errors under
      // `message` depending on the path, so check both rather than picking one
      // and silently falling back to the generic text.
      const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      setError(data?.message || data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+S saves from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, settings, token, saving]);

  const set = useCallback((key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setJustSaved(false);
  }, []);
  const get = (key: string) => settings[key] || '';
  const on = (key: string) => settings[key] === 'true';
  const setBool = (key: string) => (v: boolean) => set(key, v ? 'true' : 'false');
  const setText = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, e.target.value);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 max-w-[920px]">
        <div className="h-7 bg-surface-elevated rounded w-32" />
        <div className="h-10 bg-surface-elevated rounded" />
        <div className="h-64 bg-surface-elevated rounded-[10px]" />
      </div>
    );
  }

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="max-w-[920px]">
      <div className="mb-5">
        <h1 className="font-display text-[20px] leading-7 font-semibold tracking-[-0.01em]">Settings</h1>
        <p className="text-[13px] leading-[18px] text-text-secondary">{current.blurb}</p>
      </div>

      <TabBar
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, dot: dirtyTabs.has(t.id) }))}
        current={tab}
        onSelect={selectTab}
        className="mb-6"
      />

      <form onSubmit={handleSave} noValidate className="space-y-6">
        <div key={tab} className="row-rise space-y-6">
          {tab === 'storefront' && (
            <>
              <Card>
                <CardHeader title="Announcement bar" description="One line above the navigation on every page." />
                <CardBody className="space-y-5">
                  <Toggle checked={on('announcement_enabled')} onChange={setBool('announcement_enabled')} label="Show the announcement bar" />
                  <Field label="Text" htmlFor="announcement_text">
                    <TextInput id="announcement_text" value={get('announcement_text')} onChange={setText('announcement_text')} placeholder="Free shipping on all orders across Peninsular Malaysia 🇲🇾" />
                  </Field>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Homepage promo"
                  description="A product carousel above “Shop by Category”. A slide whose slug doesn’t match an active product renders nothing."
                />
                <CardBody className="space-y-5">
                  <Toggle checked={on('hardsell_enabled')} onChange={setBool('hardsell_enabled')} label="Show the promo section" />
                  <SlideFields prefix="hardsell" get={get} setText={setText} placeholderSlug="retatrutide" />
                  <div className="border-t border-border pt-5 space-y-5">
                    <Toggle checked={on('hardsell_slide2_enabled')} onChange={setBool('hardsell_slide2_enabled')} label="Add a second slide" />
                    {on('hardsell_slide2_enabled') && <SlideFields prefix="hardsell_slide2" get={get} setText={setText} placeholderSlug="ghk-cu" />}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Newsletter popup"
                  description="Exit intent on desktop, half-page scroll or 15 seconds on mobile. Never on cart, checkout or order pages, never twice a session, and silent for 30 days after it’s closed."
                />
                <CardBody className="space-y-5">
                  <Toggle checked={on('newsletter_popup_enabled')} onChange={setBool('newsletter_popup_enabled')} label="Show the signup popup" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Heading" htmlFor="newsletter_popup_heading">
                      <TextInput id="newsletter_popup_heading" value={get('newsletter_popup_heading')} onChange={setText('newsletter_popup_heading')} placeholder="Reconstitution reference, free" />
                    </Field>
                    <Field label="Body" htmlFor="newsletter_popup_body" help="The discount isn’t mentioned here on purpose — it arrives in the welcome email, so the storefront never trains people to wait for a code.">
                      <TextInput id="newsletter_popup_body" value={get('newsletter_popup_body')} onChange={setText('newsletter_popup_body')} placeholder="Dosing calculator, storage guide, and batch COAs." />
                    </Field>
                  </div>
                </CardBody>
              </Card>
            </>
          )}

          {tab === 'payments' && (
            <>
              {/* Three independent switches on purpose: each adds an option at
                  checkout without replacing the others. */}
              <Card>
                <CardHeader title="Online payment" description="Card, FPX and e-wallets through a gateway. Credentials live in the server environment, not here." />
                <CardBody className="space-y-5">
                  <Toggle checked={on('online_payment_enabled')} onChange={setBool('online_payment_enabled')} label="Accept online payment at checkout" />
                  <Field label="Gateway" htmlFor="payment_gateway" className="max-w-xs">
                    <SelectInput id="payment_gateway" value={settings.payment_gateway || 'billplz'} onChange={setText('payment_gateway')}>
                      <option value="billplz">Billplz — FPX, e-wallets, cards</option>
                      <option value="toyyibpay">ToyyibPay — FPX, cards</option>
                    </SelectInput>
                  </Field>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Crypto" description="Bitcoin, settled through the self-hosted BTCPay Server." />
                <CardBody>
                  <Toggle
                    checked={on('crypto_payment_enabled')}
                    onChange={setBool('crypto_payment_enabled')}
                    label="Accept Bitcoin at checkout"
                    description={
                      <>
                        Needs <code className="font-mono text-[12px]">BTCPAY_URL</code>, <code className="font-mono text-[12px]">BTCPAY_API_KEY</code>, <code className="font-mono text-[12px]">BTCPAY_STORE_ID</code> and <code className="font-mono text-[12px]">BTCPAY_WEBHOOK_SECRET</code> in the server environment.
                      </>
                    }
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Bank transfer / DuitNow"
                  description="A hosted payment page with your QR and account details, where the customer uploads a screenshot of the transfer. You confirm the order by approving it on the order page."
                />
                <CardBody>
                  <Toggle
                    checked={on('manual_payment_enabled')}
                    onChange={setBool('manual_payment_enabled')}
                    label="Offer bank transfer at checkout"
                    description="Each account below has its own switch, so one can be paused without turning the page off."
                  />
                </CardBody>
              </Card>

              {/* Renders its own cards (branding, one per method) at the same
                  level as the ones above — not nested inside a card. */}
              <ManualPaySettings raw={settings[MANUALPAY_CONFIG_KEY]} onChange={(json) => set(MANUALPAY_CONFIG_KEY, json)} />
            </>
          )}

          {tab === 'shipping' && (
            <>
              <Card>
                <CardHeader title="Delivery fee" description="East Malaysia means Sabah, Sarawak and Labuan." />
                <CardBody>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Peninsular Malaysia" htmlFor="shipping_fee" help="0 for free shipping.">
                      <Affixed prefix="RM">
                        <input id="shipping_fee" type="number" min="0" step="0.01" value={get('shipping_fee')} onChange={setText('shipping_fee')} placeholder="0.00" />
                      </Affixed>
                    </Field>
                    <Field label="East Malaysia" htmlFor="east_malaysia_shipping_fee" help="Blank charges the Peninsular fee; 0 ships free.">
                      <Affixed prefix="RM">
                        <input id="east_malaysia_shipping_fee" type="number" min="0" step="0.01" value={get('east_malaysia_shipping_fee')} onChange={setText('east_malaysia_shipping_fee')} placeholder="Same as Peninsular" />
                      </Affixed>
                    </Field>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="East Malaysia minimum order" description="Checkout blocks an East Malaysia order whose products total, before discount and shipping, is under this." />
                <CardBody>
                  <Field label="Minimum" htmlFor="east_malaysia_min_order" help="Blank or 0 accepts any size." className="max-w-xs">
                    <Affixed prefix="RM">
                      <input id="east_malaysia_min_order" type="number" min="0" step="0.01" value={get('east_malaysia_min_order')} onChange={setText('east_malaysia_min_order')} placeholder="0.00" />
                    </Affixed>
                  </Field>
                </CardBody>
              </Card>
            </>
          )}

          {tab === 'business' && (
            <>
              <Card>
                <CardHeader title="Store" />
                <CardBody className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Business name" htmlFor="business_name">
                      <TextInput id="business_name" value={get('business_name')} onChange={setText('business_name')} placeholder="Ascend MY" />
                    </Field>
                    <Field label="Tagline" htmlFor="business_tagline">
                      <TextInput id="business_tagline" value={get('business_tagline')} onChange={setText('business_tagline')} placeholder="Premium Peptides Malaysia" />
                    </Field>
                  </div>
                  <Field
                    label="WhatsApp number"
                    htmlFor="whatsapp_number"
                    help="International format, digits only, no plus: 011-6109 2723 becomes 601161092723. Used for WhatsApp checkout and the chat button."
                    className="max-w-xs"
                  >
                    <TextInput id="whatsapp_number" inputMode="numeric" value={get('whatsapp_number')} onChange={setText('whatsapp_number')} placeholder="601161092723" />
                  </Field>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Receipts and invoices" description="Printed on customer receipts and PDF invoices." />
                <CardBody className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Company name" htmlFor="receipt_company_name">
                      <TextInput id="receipt_company_name" value={get('receipt_company_name')} onChange={setText('receipt_company_name')} placeholder="Ascend Peptides" />
                    </Field>
                    <Field label="Registration number" htmlFor="receipt_company_reg" help="Optional.">
                      <TextInput id="receipt_company_reg" value={get('receipt_company_reg')} onChange={setText('receipt_company_reg')} placeholder="SA0012345-X" />
                    </Field>
                    <Field label="Phone" htmlFor="receipt_phone">
                      <TextInput id="receipt_phone" value={get('receipt_phone')} onChange={setText('receipt_phone')} placeholder="011-6109 2723" />
                    </Field>
                    <Field label="Email" htmlFor="receipt_email">
                      <TextInput id="receipt_email" type="email" value={get('receipt_email')} onChange={setText('receipt_email')} placeholder="hello@ascendpeptides.my" />
                    </Field>
                  </div>
                  <Field label="Address" htmlFor="receipt_address">
                    <TextInput id="receipt_address" value={get('receipt_address')} onChange={setText('receipt_address')} placeholder="Johor Bahru, Malaysia" />
                  </Field>
                  <Field label="Footer note" htmlFor="receipt_footer_note">
                    <TextInput id="receipt_footer_note" value={get('receipt_footer_note')} onChange={setText('receipt_footer_note')} placeholder="All products are for research and laboratory use only." />
                  </Field>
                </CardBody>
              </Card>
            </>
          )}

          {tab === 'emails' && (
            <>
              <Card>
                <CardHeader title="Marketing" description="Separate from order emails on purpose: turning this off pauses newsletters while confirmations and receipts keep going out." />
                <CardBody className="space-y-5">
                  <Toggle
                    checked={on('marketing_emails_enabled')}
                    onChange={setBool('marketing_emails_enabled')}
                    label="Send welcome emails and campaigns"
                    description="Needs the Emails switch on as well."
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Welcome discount" htmlFor="welcome_discount_percent" help="0 sends the welcome email without a code. Every subscriber gets their own single-use code.">
                      <Affixed suffix="%">
                        <input id="welcome_discount_percent" type="number" min="0" max="100" value={get('welcome_discount_percent')} onChange={setText('welcome_discount_percent')} placeholder="0" />
                      </Affixed>
                    </Field>
                    <Field label="Code valid for" htmlFor="welcome_discount_days">
                      <Affixed suffix="days">
                        <input id="welcome_discount_days" type="number" min="1" value={get('welcome_discount_days')} onChange={setText('welcome_discount_days')} placeholder="30" />
                      </Affixed>
                    </Field>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Payment reminders" />
                <CardBody>
                  <Toggle
                    checked={on('abandoned_checkout_enabled')}
                    onChange={setBool('abandoned_checkout_enabled')}
                    label="Remind customers who didn’t finish paying"
                    description="One email, about 45 minutes after an unpaid order, with a link back to the still-open payment page. Never twice, and never after the order is paid or cancelled."
                  />
                </CardBody>
              </Card>
            </>
          )}
        </div>

        <SaveBar>
          <p className="flex-1 min-w-[10rem] px-1 text-[13px] leading-[18px]">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : justSaved && !isDirty ? (
              <span className="inline-flex items-center gap-1.5 text-success font-medium"><Check className="w-4 h-4" /> Saved</span>
            ) : isDirty ? (
              <span className="text-text-secondary">
                <span className="font-medium text-text-primary">{dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? 'change' : 'changes'}</span>
                {' '}in {TABS.filter((t) => dirtyTabs.has(t.id)).map((t) => t.label).join(', ')}
              </span>
            ) : (
              <span className="text-text-secondary">No unsaved changes</span>
            )}
          </p>
          {isDirty && (
            <Button type="button" variant="outline" size="sm" onClick={() => { setSettings(baseline); setError(''); }} disabled={saving}>
              Discard
            </Button>
          )}
          <Button type="submit" size="sm" disabled={saving || !isDirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </SaveBar>
      </form>
    </div>
  );
}

function SlideFields({
  prefix,
  get,
  setText,
  placeholderSlug,
}: {
  prefix: string;
  get: (k: string) => string;
  setText: (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholderSlug: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Product slug" htmlFor={`${prefix}_product_slug`} help={`The URL at /products/${placeholderSlug}.`}>
        <TextInput id={`${prefix}_product_slug`} value={get(`${prefix}_product_slug`)} onChange={setText(`${prefix}_product_slug`)} placeholder={placeholderSlug} />
      </Field>
      <Field label="Headline" htmlFor={`${prefix}_headline`} help="Blank shows the product name.">
        <TextInput id={`${prefix}_headline`} value={get(`${prefix}_headline`)} onChange={setText(`${prefix}_headline`)} />
      </Field>
      <Field label="Subheadline" htmlFor={`${prefix}_subheadline`} className="sm:col-span-2">
        <TextInput id={`${prefix}_subheadline`} value={get(`${prefix}_subheadline`)} onChange={setText(`${prefix}_subheadline`)} placeholder="Optional" />
      </Field>
    </div>
  );
}
