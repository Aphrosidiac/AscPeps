import { renderLayout, renderButton, escapeHtml, formatDate, formatRM, SITE_URL, FONT, MONO, INK, BODY, MUTED, BORDER, ACCENT } from './layout.js';
import { batchLabel, type GroupBuyStage } from '../utils/group-buy.js';

/**
 * The two emails a Group Buy batch sends outside the order outbox: the
 * sign-up welcome (with the reward code when there is one) and the stage
 * update every buyer gets when the batch moves on. Same layout as the order
 * mail so the customer reads one brand.
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
  return r.type === 'PERCENTAGE' ? `${r.value}% OFF` : `${formatRM(r.value)} OFF`;
}

function scopeText(r: SignupReward, gb: BatchRef): string {
  if (r.scope === 'GROUP_BUY') return `your ${batchLabel(gb.number)} order`;
  if (r.scope === 'STORE') return 'your next order in the store';
  return 'your next order, in the store or the Group Buy';
}

function renderCode(r: SignupReward, gb: BatchRef): string {
  const lines = [
    'Single use, tied to this email address.',
    r.expiresAt ? `Valid until ${formatDate(r.expiresAt)}.` : '',
    r.minOrderAmount ? `On orders over ${formatRM(r.minOrderAmount)}.` : '',
  ].filter(Boolean).join(' ');
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;">
            <tr>
              <td align="center" class="code-box" style="padding:22px 16px;border:1px dashed ${INK};border-radius:10px;">
                <p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">${rewardText(r)} ${escapeHtml(scopeText(r, gb).toUpperCase())}</p>
                <p class="ink" style="margin:0;font-family:${MONO};font-size:26px;font-weight:700;letter-spacing:3px;color:${INK};">${escapeHtml(r.code)}</p>
                <p class="muted" style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${MUTED};">${lines}</p>
              </td>
            </tr>
          </table>`;
}

export function renderGroupBuySignup(
  gb: BatchRef,
  name: string | null,
  reward: SignupReward | null,
  settings: Record<string, string>
): { subject: string; html: string } {
  const url = `${SITE_URL}/group-buy/${gb.slug}`;
  const hello = name ? `Hi ${escapeHtml(name.split(' ')[0])}, you're` : "You're";
  const body = `
          <p class="body-text" style="margin:0 0 18px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">
            ${hello} on the list for <strong class="ink" style="color:${INK};">${escapeHtml(gb.title)}</strong> (${batchLabel(gb.number)}). It closes on ${formatDate(gb.closesAt)}; we'll let you know before it does.
          </p>
          <p class="body-text" style="margin:0;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">
            Batch prices drop as your quantity goes up — the full price list is on the batch page.
          </p>${reward ? renderCode(reward, gb) : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;">
            <tr><td>${renderButton('SEE THE BATCH', url)}</td></tr>
          </table>
          <p class="muted" style="margin:22px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            Create an Ascend MY account with this email to follow your orders and the batch timeline in one place: <a href="${SITE_URL}/account/register" style="color:${INK};">ascendpeptides.my/account/register</a>
          </p>`;
  return {
    subject: reward
      ? `You're in — ${batchLabel(gb.number)} and your ${rewardText(reward).toLowerCase()} code`
      : `You're on the list for ${batchLabel(gb.number)}`,
    html: renderLayout({
      hero: { badge: { label: `GROUP BUY · ${batchLabel(gb.number).toUpperCase()}` }, headline: "You're on the list.", subhead: escapeHtml(gb.title) },
      body,
      preheader: reward ? `Your ${rewardText(reward).toLowerCase()} code for ${batchLabel(gb.number)} is inside.` : `${gb.title} closes on ${formatDate(gb.closesAt)}.`,
      settings,
    }),
  };
}

function renderTimeline(stages: GroupBuyStage[], currentKey: string): string {
  const at = Math.max(stages.findIndex((s) => s.key === currentKey), 0);
  return stages
    .map((s, i) => {
      const done = i < at;
      const now = i === at;
      const dot = done || now ? (now ? ACCENT : INK) : '#d4d4d8';
      const label = now ? `<strong>${escapeHtml(s.label)}</strong>` : escapeHtml(s.label);
      const when = s.doneAt && (done || now) ? ` <span class="muted" style="color:${MUTED};">&middot; ${formatDate(s.doneAt)}</span>` : s.eta && !done ? ` <span class="muted" style="color:${MUTED};">&middot; ${escapeHtml(s.eta)}</span>` : '';
      return `
            <tr>
              <td width="22" valign="top" style="width:22px;padding:6px 0;">
                <table role="presentation" width="10" height="10" cellpadding="0" cellspacing="0"><tr><td width="10" height="10" bgcolor="${dot}" style="width:10px;height:10px;line-height:10px;font-size:0;background-color:${dot};border-radius:50%;">&nbsp;</td></tr></table>
              </td>
              <td class="${done || now ? 'ink' : 'muted'}" style="padding:3px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${done || now ? INK : MUTED};">${label}${when}</td>
            </tr>`;
    })
    .join('');
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
  const body = `
          <p class="body-text" style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">
            ${escapeHtml(stage.detail || `${batchLabel(gb.number)} is at: ${stage.label}.`)}
          </p>${stage.note ? `
          <p class="body-text" style="margin:12px 0 0;padding:12px 14px;border-left:3px solid ${INK};font-family:${FONT};font-size:14px;line-height:1.6;color:${INK};">${escapeHtml(stage.note)}</p>` : ''}
          <p class="eyebrow muted" style="margin:26px 0 10px;padding-bottom:10px;border-bottom:2px solid ${INK};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">BATCH TIMELINE</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderTimeline(stages, stage.key)}
          </table>
          <p class="body-text" style="margin:22px 0 0;padding-top:14px;border-top:1px solid ${BORDER};font-family:${FONT};font-size:13px;line-height:1.6;color:${BODY};">
            Your order: <span class="ink" style="font-family:${MONO};color:${INK};">${escapeHtml(order.orderNumber)}</span>${gb.shipEstimate ? ` &middot; estimated to ship ${escapeHtml(gb.shipEstimate)}` : ''}
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;">
            <tr><td>${renderButton('VIEW YOUR ORDER', trackUrl)}</td></tr>
          </table>`;
  return {
    subject: `${batchLabel(gb.number)}: ${stage.label}`,
    html: renderLayout({
      hero: { badge: { label: `GROUP BUY · ${batchLabel(gb.number).toUpperCase()}`, tone: 'success' }, headline: escapeHtml(stage.label) + '.', subhead: escapeHtml(gb.title) },
      body,
      preheader: stage.note || stage.detail || `${batchLabel(gb.number)} update`,
      settings,
    }),
  };
}
