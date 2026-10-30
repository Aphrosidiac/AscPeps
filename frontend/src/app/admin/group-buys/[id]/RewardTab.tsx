'use client';

import { useEffect, useState } from 'react';
import { adminPreviewGroupBuyEmail, type AdminGroupBuy } from '@/lib/group-buy-api';
import { Card, CardBody, CardHeader, Field, SelectInput, TextInput, Toggle } from '@/components/admin/ui';
import { EmailPreview } from '@/components/admin/EmailPreview';
import { IntInput, MoneyInput, nullIfEmpty } from '../shared';
import type { Draft, SetDraft } from './page';

/**
 * The sign-up reward: everyone who joins the batch's list (batch page, popup,
 * home section) gets their own single-use code, tied to their email and sent
 * to their inbox. Already-issued codes keep the terms they were issued with.
 */
export function RewardTab({ draft, set, gb, token }: { draft: Draft; set: SetDraft; gb: AdminGroupBuy; token: string }) {
  const [html, setHtml] = useState('');
  const pct = draft.rewardType === 'PERCENTAGE';
  const offer = pct ? `${draft.rewardValue}% off` : `RM${(draft.rewardValue / 100).toFixed(2).replace(/\.00$/, '')} off`;
  const where = draft.rewardScope === 'GROUP_BUY' ? 'your batch order' : draft.rewardScope === 'STORE' ? 'your next store order' : 'your next order';

  // The preview renders what is SAVED, so it refreshes when the batch reloads.
  useEffect(() => {
    adminPreviewGroupBuyEmail(token, gb.id, 'SIGNUP').then((r) => setHtml(r.html)).catch(() => setHtml(''));
  }, [token, gb.id, gb.updatedAt]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="h-fit">
        <CardHeader title="Sign-up reward" description="A first-purchase code for everyone who joins this batch’s list." actions={<Toggle checked={draft.rewardEnabled} onChange={(v) => set('rewardEnabled', v)} label="" />} />
        <CardBody className="grid gap-5 md:grid-cols-2">
          <Field label="Discount">
            <SelectInput value={draft.rewardType} onChange={(e) => set('rewardType', e.target.value as Draft['rewardType'])}>
              <option value="PERCENTAGE">Percentage off</option>
              <option value="FIXED_AMOUNT">Amount off (RM)</option>
            </SelectInput>
          </Field>
          <Field label={pct ? 'Percent' : 'Amount'}>
            {pct ? (
              <IntInput value={draft.rewardValue} onChange={(v) => set('rewardValue', Math.min(v ?? 0, 100))} suffix="%" />
            ) : (
              <MoneyInput value={draft.rewardValue} onChange={(v) => set('rewardValue', v ?? 0)} />
            )}
          </Field>
          <Field label="Can be used on">
            <SelectInput value={draft.rewardScope} onChange={(e) => set('rewardScope', e.target.value as Draft['rewardScope'])}>
              <option value="GROUP_BUY">This batch only</option>
              <option value="STORE">The store only</option>
              <option value="ANY">Store or any batch</option>
            </SelectInput>
          </Field>
          <Field label="Minimum spend" help="Empty = none">
            <MoneyInput value={draft.rewardMinOrder} onChange={(v) => set('rewardMinOrder', v)} />
          </Field>
          <Field label="Valid for" help="From sign-up. Empty = no expiry">
            <IntInput min={1} value={draft.rewardValidDays} onChange={(v) => set('rewardValidDays', v)} suffix="days" />
          </Field>
          <Field label="Headline" help={`Empty = “Join the list and get ${offer} ${where}”`}>
            <TextInput value={draft.rewardHeadline ?? ''} onChange={(e) => set('rewardHeadline', nullIfEmpty(e.target.value))} maxLength={160} />
          </Field>
          <div className="md:col-span-2">
            <Toggle
              checked={draft.rewardMembersOnly}
              onChange={(v) => set('rewardMembersOnly', v)}
              label="Members only"
              description="Only signed-in Ascend members get the code. Guests can still join the list and are asked to make an account for it."
            />
          </div>
          <ul className="md:col-span-2 list-disc space-y-1 pl-5 text-[13px] text-text-secondary">
            <li>One code per person, single use, and checkout refuses it for any other email address.</li>
            <li>The code is emailed, never shown on screen to a guest — the inbox is the proof the address is theirs. A signed-in member with a confirmed email also sees it on screen.</li>
            <li>Codes appear in Marketing → Discounts and in this batch’s Sign-ups tab.</li>
          </ul>
        </CardBody>
      </Card>

      <div>
        <p className="mb-2 text-[13px] font-medium text-text-primary">Welcome email <span className="font-normal text-text-secondary">· as saved, with a sample code</span></p>
        {html ? <EmailPreview html={html} /> : <div className="h-96 rounded-[10px] bg-surface-elevated" />}
      </div>
    </div>
  );
}
