import {
  renderLayout,
  paragraph,
  heading,
  button,
  note,
  notice,
  codeBox,
  details,
  link,
  spacer,
  escapeHtml,
  formatDate,
  formatRM,
  SITE_URL,
  FONT,
  INK,
  MUTED,
  LINE,
  ACCENT,
} from './layout.js';
import { batchLabel, type GroupBuyStage } from '../utils/group-buy.js';

/**
 * The two Group Buy mails sent outside the order outbox: the sign-up welcome
 * (with the reward code when there is one) and the stage update every buyer
 * gets when the batch moves on.
 */

interface BatchRef { number: number; slug: string; title: string; closesAt: Date; shipEstimate: string | null }

export interface SignupReward {
  code: string;
  type: string; // PERCENTAGE | FIXED_AMOUNT
  value: number;
  expiresAt: Date | null;
  minOrderAmount: number | null;
  scope: string | null; // null = anywhere
}

function rewardText(r: SignupReward): string {
  return r.type === 'PERCENTAGE' ? `${r.value}% off` : `${formatRM(r.value)} off`;
}

function scopeText(r: SignupReward, gb: BatchRef): string {
  if (r.scope === 'GROUP_BUY') return `your ${batchLabel(gb.number)} order`;
  if (r.scope === 'STORE') return 'your next order in the store';
  return 'your next order, in the store or the Group Buy';
}

export function renderGroupBuySignup(
  gb: BatchRef,
  name: string | null,
  reward: SignupReward | null,
  settings: Record<string, string>
): { subject: string; html: string } {
  const url = `${SITE_URL}/group-buy/${gb.slug}`;
  const hello = name ? `Hi ${escapeHtml(name.split(' ')[0])}, you&#39;re` : 'You&#39;re';
  const code = reward
    ? codeBox(
        `${rewardText(reward)} ${escapeHtml(scopeText(reward, gb))}`,
        reward.code,
        [
          'One use, tied to this email address.',
          reward.expiresAt ? `Valid until ${formatDate(reward.expiresAt)}.` : '',
          reward.minOrderAmount ? `On orders over ${formatRM(reward.minOrderAmount)}.` : '',
        ].filter(Boolean).join(' ')
      )
    : '';

  return {
    subject: reward
      ? `You're in — ${batchLabel(gb.number)} and your ${rewardText(reward)} code`
      : `You're on the list for ${batchLabel(gb.number)}`,
    html: renderLayout({
      eyebrow: `Group Buy &middot; ${batchLabel(gb.number)}`,
      headline: 'You&#39;re on the list',
      meta: escapeHtml(gb.title),
      body: `${paragraph(
        `${hello} on the list for <strong>${escapeHtml(gb.title)}</strong>. It closes on ${formatDate(gb.closesAt)}, and we&#39;ll let you know before it does. Batch prices drop as your quantity goes up; the full price list is on the batch page.`,
        { mb: 24 }
      )}${code}${button('See the batch', url, { mt: 0 })}${note(
        `Create an Ascend MY account with this email to follow your orders and the batch timeline in one place: ${link('create an account', `${SITE_URL}/account/register`)}.`,
        24
      )}`,
      preheader: reward
        ? `Your ${rewardText(reward)} code for ${batchLabel(gb.number)} is inside.`
        : `${gb.title} closes on ${formatDate(gb.closesAt)}.`,
      settings,
    }),
  };
}

/** The batch's stages as a quiet checklist: done, now (green), still to come. */
function timeline(stages: GroupBuyStage[], currentKey: string): string {
  const at = Math.max(stages.findIndex((s) => s.key === currentKey), 0);
  const rows = stages
    .map((s, i) => {
      const done = i < at;
      const now = i === at;
      const dot = now ? ACCENT : done ? INK : '#D4D4D4';
      const when = s.doneAt && (done || now) ? formatDate(s.doneAt) : s.eta && !done ? escapeHtml(s.eta) : '';
      const top = i ? `border-top:1px solid ${LINE};` : '';
      return `
            <tr>
              <td width="20" valign="middle" style="width:20px;padding:11px 0;${top}">
                <table role="presentation" width="8" cellpadding="0" cellspacing="0"><tr><td width="8" height="8" bgcolor="${dot}" style="width:8px;height:8px;font-size:0;line-height:0;background-color:${dot};border-radius:50%;">&nbsp;</td></tr></table>
              </td>
              <td valign="middle" style="padding:11px 0;${top}font-family:${FONT};font-size:14px;line-height:1.4;color:${done || now ? INK : MUTED};${now ? 'font-weight:600;' : ''}">${escapeHtml(s.label)}</td>
              <td align="right" valign="middle" style="padding:11px 0 11px 12px;${top}font-family:${FONT};font-size:13px;line-height:1.4;color:${MUTED};white-space:nowrap;">${when}</td>
            </tr>`;
    })
    .join('');
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">${rows}
          </table>`;
}

export function renderGroupBuyStage(
  gb: BatchRef,
  stages: GroupBuyStage[],
  stageKey: string,
  order: { orderNumber: string; customerName: string; phone: string },
  settings: Record<string, string>
): { subject: string; html: string } {
  const stage = stages.find((s) => s.key === stageKey) ?? stages[0];
  const trackUrl = `${SITE_URL}/track?order=${encodeURIComponent(order.orderNumber)}`;
  const facts: [string, string][] = [['Your order', `#${escapeHtml(order.orderNumber)}`]];
  if (gb.shipEstimate) facts.push(['Estimated to ship', escapeHtml(gb.shipEstimate)]);

  return {
    subject: `${batchLabel(gb.number)}: ${stage.label}`,
    html: renderLayout({
      eyebrow: `Group Buy &middot; ${batchLabel(gb.number)}`,
      headline: escapeHtml(stage.label),
      meta: escapeHtml(gb.title),
      body: `${paragraph(escapeHtml(stage.detail || `${batchLabel(gb.number)} is at: ${stage.label}.`), { mb: stage.note ? 16 : 0 })}${
        stage.note ? notice('A note from the team', escapeHtml(stage.note), { mb: 0 }) : ''
      }${heading('Batch timeline')}${timeline(stages, stage.key)}${spacer(24)}${details(facts)}${button('View your order', trackUrl, { mt: 0 })}`,
      preheader: stage.note || stage.detail || `${batchLabel(gb.number)} update`,
      settings,
    }),
  };
}
