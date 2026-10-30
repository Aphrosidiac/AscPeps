'use client';

import { Card, CardBody, CardHeader, Field, SelectInput, TextArea, TextInput, Toggle } from '@/components/admin/ui';
import { DateTimeInput, ImageField, IntInput, nullIfEmpty } from '../shared';
import type { Draft, SetDraft } from './page';

const TONE: Record<Draft['bannerTone'], string> = { INK: 'bg-[#0A0A0A] text-white', GREEN: 'bg-[#22C55E] text-[#0A0A0A]', COBALT: 'bg-[#3155D9] text-white' };

/**
 * How the storefront promotes the batch: a banner across the top, a popup and
 * a home-page section. Each switches on and off on its own; the banner and the
 * popup also have their own schedule inside the batch window (empty = all the
 * time the batch is live or upcoming).
 */
export function PromoTab({ draft, set, token }: { draft: Draft; set: SetDraft; token: string }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Banner" description="A strip across the top of every store page, linking to the batch." actions={<Toggle checked={draft.bannerEnabled} onChange={(v) => set('bannerEnabled', v)} label="" />} />
        <CardBody className="space-y-5">
          <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[6px] px-4 py-2.5 text-center text-[13px] ${TONE[draft.bannerTone]} ${draft.bannerEnabled ? '' : 'opacity-40'}`}>
            <span className="font-medium">{draft.bannerText || 'Banner text'}</span>
            <span className="underline underline-offset-2">{draft.bannerCta || 'Join the batch'} →</span>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <Field label="Text" className="md:col-span-2">
              <TextInput value={draft.bannerText ?? ''} onChange={(e) => set('bannerText', nullIfEmpty(e.target.value))} maxLength={200} />
            </Field>
            <Field label="Link text">
              <TextInput value={draft.bannerCta ?? ''} placeholder="Join the batch" onChange={(e) => set('bannerCta', nullIfEmpty(e.target.value))} maxLength={40} />
            </Field>
            <Field label="Colour">
              <SelectInput value={draft.bannerTone} onChange={(e) => set('bannerTone', e.target.value as Draft['bannerTone'])}>
                <option value="INK">Ink</option>
                <option value="GREEN">Signal Green</option>
                <option value="COBALT">Cobalt</option>
              </SelectInput>
            </Field>
            <Field label="Show from" help="Empty = now">
              <DateTimeInput value={draft.bannerStartsAt} onChange={(v) => set('bannerStartsAt', v)} />
            </Field>
            <Field label="Show until" help="Empty = until the batch closes">
              <DateTimeInput value={draft.bannerEndsAt} onChange={(v) => set('bannerEndsAt', v)} />
            </Field>
          </div>
          <p className="text-[13px] text-text-secondary">While it shows, it replaces the store’s own announcement bar.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Popup" description="A card that opens over the store after a short delay. It never opens on checkout or payment pages." actions={<Toggle checked={draft.popupEnabled} onChange={(v) => set('popupEnabled', v)} label="" />} />
        <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Title" className="md:col-span-2">
              <TextInput value={draft.popupTitle ?? ''} onChange={(e) => set('popupTitle', nullIfEmpty(e.target.value))} maxLength={120} />
            </Field>
            <Field label="Text" className="md:col-span-2">
              <TextArea rows={3} value={draft.popupBody ?? ''} onChange={(e) => set('popupBody', nullIfEmpty(e.target.value))} maxLength={600} />
            </Field>
            <Field label="Button">
              <TextInput value={draft.popupCta ?? ''} placeholder="See the batch" onChange={(e) => set('popupCta', nullIfEmpty(e.target.value))} maxLength={40} />
            </Field>
            <Field label="Open after" help="seconds on the page">
              <IntInput value={draft.popupDelaySec} onChange={(v) => set('popupDelaySec', v ?? 0)} suffix="sec" />
            </Field>
            <Field label="How often">
              <SelectInput value={draft.popupFrequency} onChange={(e) => set('popupFrequency', e.target.value as Draft['popupFrequency'])}>
                <option value="ONCE">Once per visitor</option>
                <option value="DAILY">Once a day</option>
                <option value="SESSION">Once per visit</option>
                <option value="EVERY">Every page view</option>
              </SelectInput>
            </Field>
            <Field label="Where">
              <SelectInput value={draft.popupPages} onChange={(e) => set('popupPages', e.target.value as Draft['popupPages'])}>
                <option value="ALL">Every store page</option>
                <option value="HOME">Home page only</option>
                <option value="PRODUCTS">Product pages</option>
              </SelectInput>
            </Field>
            <Field label="Show from" help="Empty = now">
              <DateTimeInput value={draft.popupStartsAt} onChange={(v) => set('popupStartsAt', v)} />
            </Field>
            <Field label="Show until" help="Empty = until the batch closes">
              <DateTimeInput value={draft.popupEndsAt} onChange={(v) => set('popupEndsAt', v)} />
            </Field>
            <Field label="Image" className="md:col-span-2">
              <ImageField token={token} value={draft.popupImageUrl} onChange={(v) => set('popupImageUrl', v)} hint="Optional. Landscape, around 1200 × 630." />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-[13px] text-text-secondary">Preview</p>
            <div className={`overflow-hidden rounded-[12px] border border-border bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.08)] ${draft.popupEnabled ? '' : 'opacity-40'}`}>
              {draft.popupImageUrl && <img src={draft.popupImageUrl} alt="" className="aspect-[1.9] w-full object-cover" />}
              <div className="space-y-2 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Group Buy</p>
                <p className="font-display text-[20px] font-semibold leading-tight">{draft.popupTitle || 'Popup title'}</p>
                {draft.popupBody && <p className="text-[14px] text-text-secondary">{draft.popupBody}</p>}
                {draft.rewardEnabled && draft.rewardValue > 0 && <p className="text-[13px] text-text-primary">+ the sign-up reward box</p>}
                <div className="pt-1"><span className="inline-flex h-9 items-center rounded-full bg-[#0A0A0A] px-4 text-[13px] font-medium text-white">{draft.popupCta || 'See the batch'}</span></div>
              </div>
            </div>
            <p className="mt-2 text-[13px] text-text-secondary">When it is on, the newsletter popup stays closed so a shopper never gets two.</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Home page section" description="A section on the home page with the batch’s products, prices and countdown." actions={<Toggle checked={draft.homeEnabled} onChange={(v) => set('homeEnabled', v)} label="" />} />
        <CardBody className="grid gap-5 md:grid-cols-2">
          <Field label="Heading" help="Empty = the batch title">
            <TextInput value={draft.homeTitle ?? ''} onChange={(e) => set('homeTitle', nullIfEmpty(e.target.value))} maxLength={120} />
          </Field>
          <Field label="Button" help="Empty = “See the batch”">
            <TextInput value={draft.homeCta ?? ''} onChange={(e) => set('homeCta', nullIfEmpty(e.target.value))} maxLength={40} />
          </Field>
          <Field label="Text" help="Empty = the tagline" className="md:col-span-2">
            <TextArea rows={2} value={draft.homeBody ?? ''} onChange={(e) => set('homeBody', nullIfEmpty(e.target.value))} maxLength={600} />
          </Field>
          <Field label="Image" className="md:col-span-2">
            <ImageField token={token} value={draft.homeImageUrl} onChange={(v) => set('homeImageUrl', v)} hint="Optional. Empty = the hero image, or the products alone." />
          </Field>
          <p className="text-[13px] text-text-secondary md:col-span-2">Shows while the batch is published and not closed — upcoming batches show a countdown to opening.</p>
        </CardBody>
      </Card>
    </div>
  );
}
