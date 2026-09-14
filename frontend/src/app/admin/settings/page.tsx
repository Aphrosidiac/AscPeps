'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Save, Check, Store, CreditCard, Truck, Building2, Mail, RotateCcw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetSettings, adminUpdateSettings } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ManualPaySettings, MANUALPAY_CONFIG_KEY } from './ManualPaySettings';

/**
 * Settings is one flat key/value bag on the server, saved in one PUT. The
 * page used to render it as one column of twelve cards with a single Save at
 * the very bottom — every new feature added another card, and by the time
 * the hosted checkout landed the form was a 4,000px scroll with the button
 * off-screen. Now: five tabs that group by what the admin is trying to do,
 * each key belonging to exactly one tab (so the tab list can show where the
 * unsaved edits are), and a save bar that follows the viewport instead of
 * hiding under the last card. The save itself is unchanged — still the whole
 * bag, still one request — so switching tabs never loses an edit.
 */
type TabId = 'storefront' | 'payments' | 'shipping' | 'business' | 'emails';

const TABS: { id: TabId; label: string; blurb: string; icon: typeof Store; keys: string[] }[] = [
  {
    id: 'storefront',
    label: 'Storefront',
    blurb: 'Announcement bar, homepage promo, newsletter popup',
    icon: Store,
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
    blurb: 'Which ways a customer can pay at checkout',
    icon: CreditCard,
    keys: ['online_payment_enabled', 'payment_gateway', 'crypto_payment_enabled', 'manual_payment_enabled', MANUALPAY_CONFIG_KEY],
  },
  {
    id: 'shipping',
    label: 'Shipping',
    blurb: 'Fees and the East Malaysia rules',
    icon: Truck,
    keys: ['shipping_fee', 'east_malaysia_shipping_fee', 'east_malaysia_min_order'],
  },
  {
    id: 'business',
    label: 'Business',
    blurb: 'Name, WhatsApp number, receipt details',
    icon: Building2,
    keys: [
      'business_name', 'business_tagline', 'whatsapp_number',
      'receipt_company_name', 'receipt_company_reg', 'receipt_address', 'receipt_phone', 'receipt_email', 'receipt_footer_note',
    ],
  },
  {
    id: 'emails',
    label: 'Emails',
    blurb: 'Welcome discount, campaigns, payment reminders',
    icon: Mail,
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
  // What the server last gave us — the baseline "unsaved changes" is measured against.
  const [saved, setSavedSnapshot] = useState<Record<string, string>>({});
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
    // replaceState rather than assigning location.hash: no scroll jump, no
    // history entry per click, but the URL still deep-links and survives reload.
    window.history.replaceState(null, '', `#${id}`);
  };

  useEffect(() => {
    if (!token) return;
    adminGetSettings(token)
      .then((s) => {
        setSettings(s);
        setSavedSnapshot(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const dirtyKeys = useMemo(
    () => Object.keys(settings).filter((k) => (settings[k] ?? '') !== (saved[k] ?? '')),
    [settings, saved]
  );
  const dirtyTabs = useMemo(() => {
    const set = new Set<TabId>();
    for (const t of TABS) if (t.keys.some((k) => dirtyKeys.includes(k))) set.add(t.id);
    return set;
  }, [dirtyKeys]);
  const isDirty = dirtyKeys.length > 0;

  // Leaving with edits pending is the one way the tabbed layout could lose
  // work that the old single scroll couldn't (the Save was always in view
  // down there) — so the browser asks first.
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
    if (!token || saving) return;
    setSaving(true);
    setError('');
    setJustSaved(false);

    try {
      const updated = await adminUpdateSettings(token, settings);
      setSettings(updated);
      setSavedSnapshot(updated);
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

  // Cmd/Ctrl+S saves from anywhere on the page, since the button may be in
  // the sticky bar rather than under the field being edited.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isDirty) void handleSave();
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
  const setBool = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.checked ? 'true' : 'false');
  const setText = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, e.target.value);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-elevated rounded w-32" />
        <div className="h-48 bg-surface-elevated rounded-xl" />
      </div>
    );
  }

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="pb-24">
      <h1 className="font-display text-2xl font-bold mb-6">Settings</h1>

      <form onSubmit={handleSave} className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8 max-w-5xl">
        {/* Tab list: a column on desktop, a scrolling strip on smaller screens. */}
        <nav
          role="tablist"
          aria-label="Settings sections"
          className="flex lg:flex-col gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-5 lg:mb-0 lg:sticky lg:top-8 lg:self-start"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(t.id)}
                className={cn(
                  'flex items-center gap-2.5 shrink-0 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors cursor-pointer',
                  active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{t.label}</span>
                {dirtyTabs.has(t.id) && (
                  <span
                    aria-label="Unsaved changes"
                    className={cn('w-1.5 h-1.5 rounded-full shrink-0', active ? 'bg-white' : 'bg-warning')}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div key={tab} className="row-rise space-y-5 min-w-0">
          <div>
            <h2 className="font-display font-semibold text-xl">{current.label}</h2>
            <p className="text-sm text-text-muted">{current.blurb}</p>
          </div>

          {tab === 'storefront' && (
            <>
              <Section title="Announcement bar" hint="One line above the navigation on every page.">
                <Toggle id="announcement_enabled" checked={on('announcement_enabled')} onChange={setBool('announcement_enabled')} label="Show the announcement bar" />
                <Input
                  label="Text"
                  id="announcement_text"
                  value={get('announcement_text')}
                  onChange={setText('announcement_text')}
                  placeholder="e.g. Free shipping on all orders across Peninsular Malaysia 🇲🇾"
                />
              </Section>

              <Section
                title="Homepage promo"
                hint="A product carousel above “Shop by Category”. Each slide needs the slug of a real, active product (the URL at /products/…); a slide whose slug doesn’t match renders nothing."
              >
                <Toggle id="hardsell_enabled" checked={on('hardsell_enabled')} onChange={setBool('hardsell_enabled')} label="Show the promo section" />
                <SlideFields prefix="hardsell" label="Slide 1" get={get} setText={setText} placeholderSlug="retatrutide" />
                <div className="border-t border-border pt-4 space-y-4">
                  <Toggle id="hardsell_slide2_enabled" checked={on('hardsell_slide2_enabled')} onChange={setBool('hardsell_slide2_enabled')} label="Add a second slide" />
                  {on('hardsell_slide2_enabled') && (
                    <SlideFields prefix="hardsell_slide2" label="Slide 2" get={get} setText={setText} placeholderSlug="ghk-cu" />
                  )}
                </div>
              </Section>

              <Section
                title="Newsletter popup"
                hint="Exit intent on desktop, half-page scroll or 15 seconds on mobile. Never on cart, checkout or order pages, never twice in a session, silent for 30 days after someone closes it. The discount is deliberately not mentioned here — it arrives in the welcome email, so the storefront never trains people to wait for a code."
              >
                <Toggle id="newsletter_popup_enabled" checked={on('newsletter_popup_enabled')} onChange={setBool('newsletter_popup_enabled')} label="Show the signup popup" />
                <Input label="Heading" id="newsletter_popup_heading" value={get('newsletter_popup_heading')} onChange={setText('newsletter_popup_heading')} placeholder="Reconstitution reference, free" />
                <Input label="Body" id="newsletter_popup_body" value={get('newsletter_popup_body')} onChange={setText('newsletter_popup_body')} placeholder="Dosing calculator, storage and handling guide, and batch COAs." />
              </Section>
            </>
          )}

          {tab === 'payments' && (
            <>
              {/* Three independent switches on purpose: online, crypto and the
                  hosted bank-transfer page each add an option at checkout
                  without replacing the others (WhatsApp is always there). */}
              <Section title="Online payment" hint="Card, FPX and e-wallets through a gateway. Credentials live in the server environment, not here.">
                <Toggle id="online_payment_enabled" checked={on('online_payment_enabled')} onChange={setBool('online_payment_enabled')} label="Enable online payment at checkout" />
                <div>
                  <label htmlFor="payment_gateway" className="block text-sm font-medium text-text-secondary mb-1">Gateway</label>
                  <select
                    id="payment_gateway"
                    value={settings.payment_gateway || 'billplz'}
                    onChange={setText('payment_gateway')}
                    className="w-full max-w-xs px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="billplz">Billplz (FPX, eWallets, Cards)</option>
                    <option value="toyyibpay">ToyyibPay (FPX, Cards)</option>
                  </select>
                </div>
              </Section>

              <Section title="Crypto">
                <Toggle
                  id="crypto_payment_enabled"
                  checked={on('crypto_payment_enabled')}
                  onChange={setBool('crypto_payment_enabled')}
                  label="Enable Bitcoin at checkout"
                  description={
                    <>
                      Settled through the self-hosted BTCPay Server; needs <code className="font-mono">BTCPAY_URL</code>, <code className="font-mono">BTCPAY_API_KEY</code>, <code className="font-mono">BTCPAY_STORE_ID</code> and <code className="font-mono">BTCPAY_WEBHOOK_SECRET</code> in the server environment.
                    </>
                  }
                />
              </Section>

              <Section
                title="Bank transfer / DuitNow"
                hint="Sends the customer to a hosted payment page with the QR and account details below, where they upload a screenshot of the transfer. The order is confirmed when you approve the screenshot on the order page. Each method has its own switch, so one account can be paused without turning the page off."
              >
                <Toggle id="manual_payment_enabled" checked={on('manual_payment_enabled')} onChange={setBool('manual_payment_enabled')} label="Enable the hosted bank-transfer checkout" />
                <ManualPaySettings raw={settings[MANUALPAY_CONFIG_KEY]} onChange={(json) => set(MANUALPAY_CONFIG_KEY, json)} />
              </Section>
            </>
          )}

          {tab === 'shipping' && (
            <Section title="Fees">
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Standard shipping (RM)" id="shipping_fee" type="number" min="0" step="0.01" value={get('shipping_fee')} onChange={setText('shipping_fee')} placeholder="0 for free shipping" />
                <Input label="East Malaysia shipping (RM)" id="east_malaysia_shipping_fee" type="number" min="0" step="0.01" value={get('east_malaysia_shipping_fee')} onChange={setText('east_malaysia_shipping_fee')} placeholder="Blank = standard fee" />
              </div>
              <Hint>
                East Malaysia means <strong>Sabah, Sarawak and Labuan</strong>. Leave the second fee blank and those orders pay the standard fee; set 0 to ship them free.
              </Hint>
              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                <Input label="East Malaysia minimum order (RM)" id="east_malaysia_min_order" type="number" min="0" step="0.01" value={get('east_malaysia_min_order')} onChange={setText('east_malaysia_min_order')} placeholder="0 for no minimum" />
              </div>
              <Hint>
                Products total (before discount and shipping) an East Malaysia order must reach, or checkout blocks it. Blank or 0 accepts any size.
              </Hint>
            </Section>
          )}

          {tab === 'business' && (
            <>
              <Section title="Store">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input label="Business name" id="business_name" value={get('business_name')} onChange={setText('business_name')} placeholder="Ascend MY" />
                  <Input label="Tagline" id="business_tagline" value={get('business_tagline')} onChange={setText('business_tagline')} placeholder="Premium Peptides Malaysia" />
                </div>
                <Input
                  label="WhatsApp number"
                  id="whatsapp_number"
                  value={get('whatsapp_number')}
                  onChange={setText('whatsapp_number')}
                  placeholder="601161092723"
                  pattern="[0-9]{10,15}"
                  className="max-w-xs"
                />
                <Hint>International format, digits only, no + (011-6109 2723 → 601161092723). Used for WhatsApp checkout and the chat button.</Hint>
              </Section>

              <Section title="Receipts & invoices" hint="Printed on customer receipts and PDF invoices.">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input label="Company name" id="receipt_company_name" value={get('receipt_company_name')} onChange={setText('receipt_company_name')} placeholder="Ascend Peptides" />
                  <Input label="Registration number" id="receipt_company_reg" value={get('receipt_company_reg')} onChange={setText('receipt_company_reg')} placeholder="Optional, e.g. SA0012345-X" />
                  <Input label="Phone" id="receipt_phone" value={get('receipt_phone')} onChange={setText('receipt_phone')} placeholder="e.g. 011-6109 2723" />
                  <Input label="Email" id="receipt_email" value={get('receipt_email')} onChange={setText('receipt_email')} placeholder="e.g. hello@ascendpeptides.my" />
                </div>
                <Input label="Address" id="receipt_address" value={get('receipt_address')} onChange={setText('receipt_address')} placeholder="e.g. Johor Bahru, Malaysia" />
                <Input label="Footer note" id="receipt_footer_note" value={get('receipt_footer_note')} onChange={setText('receipt_footer_note')} placeholder="All products are for research and laboratory use only." />
              </Section>
            </>
          )}

          {tab === 'emails' && (
            <>
              <Section title="Marketing">
                <Toggle
                  id="marketing_emails_enabled"
                  checked={on('marketing_emails_enabled')}
                  onChange={setBool('marketing_emails_enabled')}
                  label="Send welcome emails and campaigns"
                  description="Separate from order emails on purpose — turning this off pauses all newsletters while confirmations and receipts keep going out. Needs the Emails switch on as well."
                />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input label="Welcome discount (%)" id="welcome_discount_percent" type="number" min="0" max="100" value={get('welcome_discount_percent')} onChange={setText('welcome_discount_percent')} placeholder="0 = no code" />
                  <Input label="Valid for (days)" id="welcome_discount_days" type="number" min="1" value={get('welcome_discount_days')} onChange={setText('welcome_discount_days')} placeholder="30" />
                </div>
                <Hint>Each subscriber gets their own single-use code, so one leaking can only ever discount one order.</Hint>
              </Section>

              <Section title="Payment reminders">
                <Toggle
                  id="abandoned_checkout_enabled"
                  checked={on('abandoned_checkout_enabled')}
                  onChange={setBool('abandoned_checkout_enabled')}
                  label="Remind customers who didn’t finish paying"
                  description="One email, ~45 minutes after an unpaid order, with a link back to the still-open payment page. Never sent twice, and never after the order is paid or cancelled."
                />
              </Section>
            </>
          )}
        </div>
      </form>

      {/* Save bar: pinned to the viewport bottom, only when there is
          something to save, so it never covers content for no reason and
          the admin never has to hunt for the button. */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 lg:left-64 z-30 transition-transform duration-200',
          isDirty || justSaved || error ? 'translate-y-0' : 'translate-y-full'
        )}
        aria-hidden={!(isDirty || justSaved || error)}
      >
        <div className="mx-4 sm:mx-6 lg:mx-8 mb-4 max-w-5xl">
          <div className="bg-surface border border-border shadow-lg rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
            <p className="text-sm flex-1 min-w-[12rem]">
              {error ? (
                <span className="text-danger">{error}</span>
              ) : justSaved && !isDirty ? (
                <span className="text-success font-medium inline-flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved</span>
              ) : (
                <>
                  <span className="font-medium">{dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? 'change' : 'changes'}</span>
                  {dirtyTabs.size > 0 && (
                    <span className="text-text-muted"> in {TABS.filter((t) => dirtyTabs.has(t.id)).map((t) => t.label).join(', ')}</span>
                  )}
                </>
              )}
            </p>
            {isDirty && (
              <Button type="button" variant="outline" size="sm" onClick={() => { setSettings(saved); setError(''); }} disabled={saving}>
                <RotateCcw className="w-3.5 h-3.5" /> Discard
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving || !isDirty}>
              {saving ? 'Saving…' : <><Save className="w-4 h-4" /> Save</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="bg-surface rounded-xl border border-border p-5 sm:p-6 space-y-4">
      <div className="space-y-1">
        <h3 className="font-display font-semibold text-base">{title}</h3>
        {hint && <p className="text-xs text-text-muted leading-relaxed">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-text-muted leading-relaxed">{children}</p>;
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
  description?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <input type="checkbox" id={id} checked={checked} onChange={onChange} className="rounded mt-0.5" />
      <label htmlFor={id} className="text-sm font-medium text-text-secondary">
        {label}
        {description && <span className="block text-xs font-normal text-text-muted mt-0.5 leading-relaxed">{description}</span>}
      </label>
    </div>
  );
}

function SlideFields({
  prefix,
  label,
  get,
  setText,
  placeholderSlug,
}: {
  prefix: string;
  label: string;
  get: (k: string) => string;
  setText: (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholderSlug: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <Input label="Product slug" id={`${prefix}_product_slug`} value={get(`${prefix}_product_slug`)} onChange={setText(`${prefix}_product_slug`)} placeholder={placeholderSlug} />
        <Input label="Headline" id={`${prefix}_headline`} value={get(`${prefix}_headline`)} onChange={setText(`${prefix}_headline`)} placeholder="Blank = product name" />
      </div>
      <Input label="Subheadline" id={`${prefix}_subheadline`} value={get(`${prefix}_subheadline`)} onChange={setText(`${prefix}_subheadline`)} placeholder="Blank to omit" />
    </div>
  );
}
