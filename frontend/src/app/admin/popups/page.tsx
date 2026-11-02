'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppWindow } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetSettings, adminUpdateSettings } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Affixed, Card, CardBody, CardHeader, Field, PageHeader, SaveBar, TextArea, TextInput, Toggle } from '@/components/admin/ui';
import { cn } from '@/lib/utils';
import {
  PLACEHOLDERS,
  TEXT_DEFAULTS,
  TRIGGER_BOUNDS,
  TRIGGER_DEFAULTS,
  settingKey,
  type PopupKind,
  type PopupText,
  type PopupTriggers,
} from '@/lib/popup-settings';

/**
 * Admin → Marketing → Popups: the store's three popups in one place — when
 * each appears, how long a closed one stays away, and what it says. All plain
 * store settings (lib/popup-settings.ts); a blank field means the default,
 * shown as its placeholder. The store picks a save up straight away.
 */

const TRIGGER_FIELDS: { t: keyof PopupTriggers; label: string; suffix: string; help: string }[] = [
  { t: 'desktopDelayS', label: 'Computer: wait', suffix: 'seconds', help: 'Then it opens when the visitor moves to leave the page.' },
  { t: 'mobileDelayS', label: 'Phone: open after', suffix: 'seconds', help: 'Or sooner, at the scroll point.' },
  { t: 'mobileScrollPct', label: 'Phone: or once scrolled', suffix: '% down', help: 'How far down the page opens it.' },
  { t: 'hideDays', label: 'Once closed, hide for', suffix: 'days', help: 'Pressing its button counts as closing. 0 = it may come back next visit.' },
];

const TEXT_FIELDS: { f: keyof PopupText; label: string; area?: boolean }[] = [
  { f: 'heading', label: 'Heading' },
  { f: 'body', label: 'Text', area: true },
  { f: 'cta', label: 'Button' },
  { f: 'note', label: 'Small print' },
];

export default function AdminPopupsPage() {
  const { token } = useAuth();
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    adminGetSettings(token).then(
      (s) => (setSaved(s), setDraft(s)),
      () => setMsg({ ok: false, text: 'Could not load the settings.' })
    );
  }, [token]);

  const get = (k: string) => draft[k] ?? '';
  const set = (k: string, v: string) => (setDraft((d) => ({ ...d, [k]: v })), setMsg(null));

  // Only what changed goes up; the rest of the settings bag is left alone.
  const changed = useMemo(
    () => (saved ? Object.keys(draft).filter((k) => (draft[k] ?? '') !== (saved[k] ?? '')) : []),
    [draft, saved]
  );
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const kind of ['newsletter', 'signup', 'affiliate'] as PopupKind[]) {
      for (const { t } of TRIGGER_FIELDS) {
        const b = TRIGGER_BOUNDS[t];
        const k = settingKey(kind, b.key);
        const v = (draft[k] ?? '').trim();
        if (v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < b.min || n > b.max) out[k] = `${b.min}–${b.max}`;
      }
    }
    return out;
  }, [draft]);

  if (!saved) {
    return msg ? <p className="py-16 text-center text-sm text-danger">{msg.text}</p> : <div className="h-96 animate-pulse rounded-[10px] bg-surface-elevated" />;
  }

  const triggers = (kind: PopupKind) => (
    <div className="border-t border-border pt-5">
      <p className="mb-3 text-[13px] font-medium text-text-primary">When it appears</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TRIGGER_FIELDS.map(({ t, label, suffix, help }) => {
          const k = settingKey(kind, TRIGGER_BOUNDS[t].key);
          return (
            <Field key={t} label={label} help={help} error={errors[k] ? `Between ${errors[k]}.` : null}>
              <Affixed suffix={suffix}>
                <input type="number" inputMode="numeric" min={TRIGGER_BOUNDS[t].min} max={TRIGGER_BOUNDS[t].max} placeholder={String(TRIGGER_DEFAULTS[t])} value={get(k)} onChange={(e) => set(k, e.target.value)} />
              </Affixed>
            </Field>
          );
        })}
      </div>
    </div>
  );

  const words = (kind: 'signup' | 'affiliate') => (
    <div className="grid gap-4 sm:grid-cols-2">
      {TEXT_FIELDS.map(({ f, label, area }) => {
        const k = settingKey(kind, f);
        return (
          <Field
            key={f}
            label={label}
            className={area ? 'sm:col-span-2' : undefined}
            help={f === 'heading' ? `Blank uses the default. ${PLACEHOLDERS[kind].join(', ')} fill in the live ${kind === 'affiliate' ? 'discount and commission' : 'bonus'}.` : undefined}
          >
            {area ? (
              <TextArea rows={3} value={get(k)} placeholder={TEXT_DEFAULTS[kind][f]} onChange={(e) => set(k, e.target.value)} />
            ) : (
              <TextInput value={get(k)} placeholder={TEXT_DEFAULTS[kind][f]} onChange={(e) => set(k, e.target.value)} />
            )}
          </Field>
        );
      })}
    </div>
  );

  const offOn = (k: string) => get(k) !== 'false';
  const programme = saved.affiliate_enabled === 'true';
  const bonus = saved.signup_bonus_enabled === 'true';

  return (
    <div className="max-w-[1080px] space-y-6">
      <PageHeader title="Popups" icon={AppWindow} subtitle="When the store's popups appear, and what they say" />
      <p className="text-[13px] text-text-secondary">
        One popup per visit: they take turns, and a live Group Buy popup goes ahead of all three. None ever shows on checkout, cart,
        account, order or payment pages.
      </p>

      <Card>
        <CardHeader title="Newsletter" description="Collects an email for the newsletter; the welcome code arrives by email." />
        <CardBody className="space-y-5">
          <Toggle checked={get('newsletter_popup_enabled') === 'true'} onChange={(v) => set('newsletter_popup_enabled', String(v))} label="Show the newsletter popup" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Heading">
              <TextInput value={get('newsletter_popup_heading')} onChange={(e) => set('newsletter_popup_heading', e.target.value)} placeholder="Reconstitution reference, free" />
            </Field>
            <Field label="Text" help="The discount isn’t mentioned here on purpose — it arrives in the welcome email, so the store never trains people to wait for a code.">
              <TextInput value={get('newsletter_popup_body')} onChange={(e) => set('newsletter_popup_body', e.target.value)} placeholder="Dosing calculator, storage guide, and batch COAs." />
            </Field>
          </div>
          {triggers('newsletter')}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sign-up bonus"
          description={
            <>
              Offers the one-time code for a new account. Only while the sign-up bonus is on —{' '}
              <span className={cn('font-medium', bonus ? 'text-success' : 'text-text-primary')}>{bonus ? 'it is on' : 'it is off'}</span> (
              <Link href="/admin/affiliates" className="underline underline-offset-2">Affiliates → Settings</Link>). Never shown to someone signed in.
            </>
          }
        />
        <CardBody className="space-y-5">
          <Toggle checked={offOn(settingKey('signup', 'enabled'))} onChange={(v) => set(settingKey('signup', 'enabled'), String(v))} label="Show the sign-up popup" />
          {words('signup')}
          {triggers('signup')}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Affiliate"
          description={
            <>
              Invites shoppers to become an affiliate. Only while the programme is open —{' '}
              <span className={cn('font-medium', programme ? 'text-success' : 'text-text-primary')}>{programme ? 'it is open' : 'it is closed'}</span> (
              <Link href="/admin/affiliates" className="underline underline-offset-2">Affiliates → Settings</Link>).
            </>
          }
        />
        <CardBody className="space-y-5">
          <Toggle checked={offOn(settingKey('affiliate', 'enabled'))} onChange={(v) => set(settingKey('affiliate', 'enabled'), String(v))} label="Show the affiliate popup" />
          <Toggle
            checked={offOn(settingKey('affiliate', 'card'))}
            onChange={(v) => set(settingKey('affiliate', 'card'), String(v))}
            label="Show the earnings card"
            description="The black card above the button: what one RM 200 order earns, and 1, 10 and 50 orders."
          />
          {words('affiliate')}
          {triggers('affiliate')}
        </CardBody>
      </Card>

      <SaveBar>
        {msg ? (
          <p className={cn('text-sm', msg.ok ? 'text-success' : 'text-danger')}>{msg.text}</p>
        ) : (
          <p className="text-sm text-text-secondary">{changed.length ? 'Unsaved changes' : 'Saved'}</p>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" disabled={!changed.length || busy} onClick={() => (setDraft(saved), setMsg(null))}>Undo</Button>
          <Button
            size="sm"
            disabled={!changed.length || busy || Object.keys(errors).length > 0}
            onClick={async () => {
              setBusy(true);
              try {
                const body = Object.fromEntries(changed.map((k) => [k, (draft[k] ?? '').trim()]));
                await adminUpdateSettings(token!, body);
                const next = { ...saved, ...body };
                setSaved(next);
                setDraft(next);
                setMsg({ ok: true, text: 'Saved. The store shows it now.' });
              } catch (err) {
                setMsg({ ok: false, text: (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.error ?? 'Could not save.' });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SaveBar>
    </div>
  );
}
