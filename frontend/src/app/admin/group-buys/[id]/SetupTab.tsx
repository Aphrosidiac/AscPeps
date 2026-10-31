'use client';

import { Card, CardBody, CardHeader, Field, SelectInput, TextArea, TextInput, Toggle } from '@/components/admin/ui';
import { useAuth } from '@/hooks/useAuth';
import { DateTimeInput, ImageField, IntInput, MoneyInput, nullIfEmpty } from '../shared';
import type { Draft, SetDraft } from './page';

/** The batch itself: what it is called, when it runs and the rules for an order. */
export function SetupTab({ draft, set }: { draft: Draft; set: SetDraft }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="The batch" description="What customers see at the top of the batch page." />
        <CardBody className="grid gap-5 md:grid-cols-2">
          <Field label="Title" htmlFor="gb-title">
            <TextInput id="gb-title" value={draft.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Link" htmlFor="gb-slug" help={`ascendpeptides.my/group-buy/${draft.slug || '…'}`}>
            <TextInput id="gb-slug" value={draft.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
          </Field>
          <Field label="Tagline" htmlFor="gb-tagline" help="One line under the title." className="md:col-span-2">
            <TextInput id="gb-tagline" value={draft.tagline ?? ''} onChange={(e) => set('tagline', nullIfEmpty(e.target.value))} />
          </Field>
          <Field label="About this batch" htmlFor="gb-desc" help="Shown on the batch page. Markdown: **bold**, lists, links." className="md:col-span-2">
            <TextArea id="gb-desc" rows={5} value={draft.description ?? ''} onChange={(e) => set('description', nullIfEmpty(e.target.value))} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="When it runs" description="Orders are taken only between these times. The batch must also be published." />
        <CardBody className="grid gap-5 md:grid-cols-3">
          <Field label="Opens" htmlFor="gb-open">
            <DateTimeInput id="gb-open" value={draft.opensAt} onChange={(v) => v && set('opensAt', v)} />
          </Field>
          <Field label="Closes" htmlFor="gb-close">
            <DateTimeInput id="gb-close" value={draft.closesAt} onChange={(v) => v && set('closesAt', v)} />
          </Field>
          <Field label="Ships (estimate)" htmlFor="gb-ship" help="Free text, e.g. “Early December”.">
            <TextInput id="gb-ship" value={draft.shipEstimate ?? ''} onChange={(e) => set('shipEstimate', nullIfEmpty(e.target.value))} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Order rules" description="For the whole order. Per-product minimums are on Products & prices." />
        <CardBody className="grid gap-5 md:grid-cols-3">
          <Field label="Minimum order" htmlFor="gb-min" help="Goods total before discount. Empty = none.">
            <MoneyInput id="gb-min" value={draft.minOrderAmount} onChange={(v) => set('minOrderAmount', v)} />
          </Field>
          <Field label="Most units per order" htmlFor="gb-max" help="Kits and vials counted as sold.">
            <IntInput id="gb-max" min={1} value={draft.maxUnitsPerOrder} onChange={(v) => set('maxUnitsPerOrder', v ?? 1)} />
          </Field>
          <Field label="Shipping" htmlFor="gb-shipfee" help={draft.shippingFee === null ? 'Uses the store’s shipping fee.' : draft.shippingFee === 0 ? 'Free shipping on batch orders.' : 'A flat fee for batch orders.'}>
            <div className="space-y-2">
              <SelectInput
                id="gb-shipfee"
                value={draft.shippingFee === null ? 'store' : draft.shippingFee === 0 ? 'free' : 'flat'}
                onChange={(e) => set('shippingFee', e.target.value === 'store' ? null : e.target.value === 'free' ? 0 : 1000)}
              >
                <option value="store">Store’s fee</option>
                <option value="free">Free</option>
                <option value="flat">Flat fee</option>
              </SelectInput>
              {draft.shippingFee !== null && draft.shippingFee > 0 && (
                <MoneyInput value={draft.shippingFee} onChange={(v) => set('shippingFee', v ?? 0)} />
              )}
            </div>
          </Field>
          <div className="md:col-span-3">
            <Toggle
              checked={draft.allowWhatsapp}
              onChange={(v) => set('allowWhatsapp', v)}
              label="Also take WhatsApp orders"
              description="Online payment is always offered. On: customers can also send the order on WhatsApp and pay by transfer."
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="People joined counter" description="Shown on the batch page and the home section. Off unless you turn it on." />
        <CardBody className="grid gap-5 md:grid-cols-3">
          <Field label="Show" htmlFor="gb-joined">
            <SelectInput id="gb-joined" value={draft.joinedMode} onChange={(e) => set('joinedMode', e.target.value as Draft['joinedMode'])}>
              <option value="OFF">Off</option>
              <option value="REAL">Real count</option>
              <option value="BOOST">Real count + a number</option>
              <option value="FIXED">A number I set</option>
            </SelectInput>
          </Field>
          {draft.joinedMode === 'BOOST' && (
            <Field label="Add" htmlFor="gb-boost" help="Added to the real count.">
              <IntInput id="gb-boost" value={draft.joinedBoost} onChange={(v) => set('joinedBoost', v ?? 0)} />
            </Field>
          )}
          {draft.joinedMode === 'FIXED' && (
            <Field label="Number shown" htmlFor="gb-fixed">
              <IntInput id="gb-fixed" value={draft.joinedFixed} onChange={(v) => set('joinedFixed', v ?? 0)} />
            </Field>
          )}
          {draft.joinedMode !== 'OFF' && (
            <Field label="Wording" htmlFor="gb-jl" help={`Reads “48 ${draft.joinedLabel}”.`}>
              <TextInput id="gb-jl" value={draft.joinedLabel} onChange={(e) => set('joinedLabel', e.target.value)} />
            </Field>
          )}
          <p className="text-[13px] text-text-secondary md:col-span-3">The real count is everyone on this batch’s list: sign-ups plus buyers.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Hero image" description="Optional. Shown on the batch page header." />
        <CardBody>
          <HeroImage draft={draft} set={set} />
        </CardBody>
      </Card>
    </div>
  );
}

function HeroImage({ draft, set }: { draft: Draft; set: SetDraft }) {
  const { token } = useAuth();
  if (!token) return null;
  return <ImageField token={token} value={draft.heroImageUrl} onChange={(v) => set('heroImageUrl', v)} hint="Wide works best, around 1600 × 700." />;
}
