# Emails

Every email the store sends: what each one is, when it goes, how it is built,
how to preview it, and how to ship a change to it. Campaigns (marketing to the
list) have their own doc, [email-campaigns.md](email-campaigns.md); affiliate
mail is listed here and explained in
[affiliate.md](affiliate.md#emails-and-notices).

[The design](#the-design) · [Every email](#every-email) ·
[How they are sent](#how-they-are-sent) · [Pre-order update](#pre-order-update) ·
[Images](#images) · [Previewing](#previewing) · [Admin](#admin) ·
[Shipping a change](#shipping-a-change) · [History](#history)

## The design

Rebuilt on 11 Nov 2026 (main `e3dcbc2`). Fakhrul's brief: the old set looked
"too clearly vibecoded"; make it modern, clean and industry standard, as clean
as Popi's. It follows Popi's structure, in Ascend's brand.

```
┌──────────────────────────────────────┐  page #F0F0F0
│ ███ Ascend MY (Rising lockup, white) │  ink header #0A0A0A, 140 px logo
├──────────────────────────────────────┤
│ Eyebrow (campaign / Group Buy only)  │  14 px grey
│ Headline                             │  Outfit 600, 28 px
│ Order #ASC… · 11 November 2026       │  grey meta line
│                                      │
│ Hi Zul,                              │  Inter 15 px body
│ Paragraphs, then one ink button      │
│                                      │
│ Section title                        │  Outfit 600, 16 px, sentence case
│ Items / grey panels / link lists     │
└──────────────────────────────────────┘  white card, 12 px radius, 600 max
  Questions? Message us on WhatsApp…     footer under the card, 12 px grey
  Disclaimer · Ascend MY · site link
  Unsubscribe (marketing only)
```

Rules the templates keep:

- **One look for every email.** All of them call `renderLayout` in
  `backend/src/emails/layout.ts` and build their body from its blocks. Never
  hand-roll a table in a template; add a block to `layout.ts` instead.
- **No vibe-coded tells.** No status chips, two-tone headlines, ALL-CAPS
  letter-spaced labels, `→` arrows, trust-badge strips, texture images or
  dashed boxes. Headings and buttons are sentence case.
- **Brand from the kit.** The header logo is the Rising lockup from
  `brand/production/Ascend-MY-Brand-Kit` rev 1.1
  (`03_LOGOS_FOR_DARK_BACKGROUNDS/Ascend-MY-Primary-On-Dark-512w.png`), copied
  to `frontend/public/images/email/ascend-my-on-dark.png`. The pill mark is
  retired and is not used in email. Colours: Ink `#0A0A0A`, text `#262626`,
  grey `#6B6B6B` (5.3:1 on white), Mist lines `#E5E5E5`, panels `#F5F5F5`.
  Signal Green `#22C55E` only marks the current Group Buy stage.
- **Light only.** `color-scheme: light only`, like Popi. Clients that
  force-invert light mail leave a dark band alone, so the white logo on the ink
  header stays readable everywhere.
- **Fonts.** Inter (body) and Outfit (headings) load from Google Fonts where a
  client allows it; everyone else gets the system stack. Outlook is told Arial
  explicitly, or Word falls back to Times New Roman.
- **Holds without CSS.** Layout is tables and inline styles. The `<style>`
  block only adds webfonts and phone padding, because the Gmail app strips it
  for non-Google accounts. The two-up product grid never stacks for the same
  reason.
- **Greeting.** `firstName()` takes the first word of the name and title-cases
  an all-caps one ("ZUL OMAR" → "Hi Zul").

### Blocks (`layout.ts`)

| Block | Use |
|---|---|
| `renderLayout({ eyebrow?, headline, meta?, body, preheader, settings, unsubscribeUrl?, unsubscribeReason? })` | The page. `preheader` is the inbox preview line. `unsubscribeUrl` only on marketing mail. |
| `paragraph(html, { size, color, mt, mb })` | Body text. |
| `heading(text, mt)` | Section title. |
| `button(label, href, { mt, secondary })` | The ink button (Outlook-safe, `nowrap`). |
| `note(html, mt)` | Small grey line, usually under a button. |
| `panel(inner)` · `notice(title, text)` · `codeBox(label, code, foot)` · `details([[label, value]])` | Grey rounded boxes: plain, with a bold lead-in, a code to copy, label/value rows. |
| `linkList([{ label, blurb, href }])` | Underlined links with a line each. |
| `renderOrderSummary(order, { title })` | Items with thumbnails and pre-order/includes notes, totals, then shipping address and payment. Shows the pre-order or Group Buy notice when the order has one. |
| `orderMeta(order, extra)` · `firstName` · `paymentMethodLabel` · `whatsappUrl` · `spacer` · `divider` · `link` | Small helpers. |

## Every email

| Email | File | When | Sent via | Switch |
|---|---|---|---|---|
| Order confirmation | `order-confirmation.ts` | Order created (queued in the same transaction) | Outbox `ORDER_CONFIRMATION` | `emails_enabled` |
| Payment receipt (+ PDF) | `payment-receipt.ts` | Order turns PAID | Outbox `PAYMENT_RECEIPT` | `emails_enabled` |
| Payment reminder | `abandoned-checkout.ts` | Unpaid gateway order, bill still open (10-min sweep) | Outbox `ABANDONED_CHECKOUT` | `abandoned_checkout_enabled` |
| Pre-order update | `preorder-update.ts` | By hand, `scripts/send-preorder-update.ts` | Outbox `PREORDER_UPDATE` | `emails_enabled` |
| Confirm your email | `verify-email.ts` | Account sign-up | Direct | `emails_enabled` |
| First-order code | `account.ts` → `renderSignupBonusEmail` | Email confirmed, sign-up bonus minted | Direct | `signup_bonus_enabled` |
| Reset password · Confirm new email · Email changed | `account.ts` | Account settings | Direct | `emails_enabled` |
| Welcome | `welcome.ts` | New subscriber | Direct | `welcome_emails_enabled` (**off**) |
| Campaign | `campaign.ts` | Admin → Campaigns | Marketing worker | `marketing_emails_enabled` |
| Group Buy sign-up · stage update | `group-buy.ts` | Batch sign-up; batch moves stage | Direct | `emails_enabled` |
| Affiliate (10 kinds) | `affiliate.ts` | Application, approval, payouts, details changes | Direct | `emails_enabled` |

The order confirmation's payment part depends on how the order pays: already
paid; hosted bank transfer (link to the payment page); WhatsApp transfer
(instructions + Open WhatsApp); online with a rebuilt bill link (Complete
payment); online with no link (Message us on WhatsApp). The receipt carries a
one-line affiliate invitation while `affiliate_enabled` is on.

Admin-editable copy (Admin → Sales → Order emails → Email content):
`email_subject_confirmation`, `email_subject_receipt`, `email_button_label`,
`email_whatsapp_instructions`, plus `abandoned_checkout_subject` and
`receipt_footer_note` (the footer disclaimer). Defaults live in the templates.
A saved value wins, typed as it is. The old `email_badge_*` settings are no
longer read.

## How they are sent

**Outbox** (`email_outbox`, worker `utils/email-worker.ts`, every 30 s): one
row per `(orderId, type)`, so an email is sent once per order even if the event
fires twice. Failed sends retry with backoff, then stop at FAILED. Admin →
Order emails has Retry failed. Before sending, the worker re-checks the order:

| Type | Skipped (marked FAILED, "order no longer eligible") when |
|---|---|
| `ORDER_CONFIRMATION` | order cancelled |
| `ABANDONED_CHECKOUT` | order cancelled or no longer UNPAID |
| `PREORDER_UPDATE` | not PAID, or no longer PENDING / CONFIRMED |
| `PAYMENT_RECEIPT` | never (a paid customer is owed the receipt) |

Resend's webhook moves SENT rows to DELIVERED, BOUNCED or COMPLAINED.

**Direct** sends (account, affiliate, Group Buy, welcome) call `sendEmail` with
no outbox row, because they have no order. Each can be asked for again.

Order emails and campaigns share one Resend account and its daily quota (see
[email-campaigns.md](email-campaigns.md)).

## Pre-order update

A reassurance note to paid pre-orders that haven't shipped: "Your pre-order is
on track … your order will ship **within the next week** … Once it ships, the
tracking number will show on your order page", a Track your order button
(`/track?order=`), then the customer's own order. The summary's standard
pre-order note ("ships in 10–14 days") is left out because this email gives
the firmer window. It has no unsubscribe link: it is about their own order.

The window comes from the `preorder_update_eta` setting (default "within the
next week").

```bash
# on the box, from backend/
npx tsx scripts/send-preorder-update.ts                                  # list only
npx tsx scripts/send-preorder-update.ts --eta "within the next week" --send
```

The list shows every paid PENDING / CONFIRMED pre-order, marks the ones with
no email ("tell them on WhatsApp") and the ones already queued. `--send` queues
one row per order. A rerun only queues orders that haven't had it.

Who it goes to, and why: only **paid** pre-orders still waiting. Shipped ones
already have their parcel, and unpaid ones must not be told "your payment is
confirmed". An unpaid customer needs a payment nudge, not this email.

**First send, 11 Nov 2026:** 9 orders queued and all 9 DELIVERED with no
retries (0002, 0005, 0009, 0011, 0014, 0019, 0023, 0029, 0037). Not emailed:
0039 Hayley Yong (paid, no email, so the team tells her on WhatsApp), 0013
(already shipped 6 Nov), and the unpaid or failed 0028, 0040, 0041 and 0043.
0028 is CONFIRMED but UNPAID; if it has really been paid, mark it paid and
rerun the script.

## Images

All image URLs end in `?v=<ASSET_VERSION>` (`layout.ts`, now **5**). Bump it
whenever an email asset changes or a URL was fetched while broken: Cloudflare
caches a 404, and some mail clients cache images by URL, so the old URL can
stay broken after the file is fixed.

- **Logo:** `/images/email/ascend-my-on-dark.png` (frontend `public/`). It has
  to be deployed with the frontend **before** a backend that references it.
- **Product thumbnails:** `<id>.email.jpg` (160 px) for order lines,
  `<id>.card.jpg` (640×512) for campaign cards. WebP is never used in email
  (older Outlook can't show it). Uploads write both. Backfill on the box from
  `backend/`: `node scripts/generate-email-thumbs.mjs --dry-run`, then without
  the flag. On 11 Nov 2026, 18 images were missing theirs (72 files written).
- **No photo:** a line-art icon (vial, droplet, swab, syringe, matched on the
  product name) in a grey tile, from `/images/email-icons/`.
- Keep `email-constellation.png` and `pill-badge-*.png` in `public/images`:
  emails already in inboxes still load them.

## Previewing

```bash
cd backend
DATABASE_URL=<a dev database> npx tsx scripts/preview-emails.ts email-preview
```

This renders every template and variant (32 files, real orders and products
from that database) and flags anything over Gmail's ~102 KB clip limit. Set
`EMAIL_ASSET_BASE_URL` to load images from a local server instead of the live
site. Admin → Order emails → Preview / Send test shows the confirmation and
receipt for a real order.

To compare against what is live, render `origin/main` into `email-preview/before`
from another worktree. The 11 Nov rework used a `gallery.html` with New /
Current and Desktop / Phone toggles, served by the `ascpeps-email-preview`
launch config. It is not committed.

To check a change on the server without sending anything, run `tsx` on a
script that imports `src/emails/*.ts` **from inside `backend/`** (so
`@prisma/client` resolves). Never import `dist/server.js`: it boots the API,
including `repairInterruptedTurns` and Abby's browser sleep, before it fails on
the port.

## Admin

- **Sales → Order emails:** the outbox list (every type, labelled
  Confirmation, Receipt, Payment reminder, Pre-order update), Retry failed,
  Preview, Send test, and Email content.
- **Order page → Emails:** the confirmation and receipt for that order, with
  Send / Resend.
- **Marketing → Campaigns:** [email-campaigns.md](email-campaigns.md).

## Shipping a change

1. Change `layout.ts` or a template, run `tsc`, and render the previews.
2. A new asset goes in `frontend/public/images/email/`. Bump `ASSET_VERSION`.
3. A new outbox type needs a migration (`ALTER TYPE "EmailType" ADD VALUE …`),
   a branch in `email-worker.ts` with its eligibility rule, and a label in
   `frontend/src/lib/email-status.ts`.
4. Deploy the **frontend first** (`./deploy-frontend.sh` with the server's
   `frontend/.env` in place for the PostHog keys), then the backend on the box:
   pull, `prisma migrate deploy` if needed, `npm run build`,
   `PORT=3105 pm2 restart ascend-api --update-env`. Check no
   `agent_threads` row is `running` before the restart.
5. Check the live asset URLs return 200, one at a time. Bulk requests to
   `/uploads` hit the API rate limit (429).

## History

- **11 Nov 2026:** whole set rebuilt on one layout (`e3dcbc2`). Removed the
  constellation hero, status chips, two-tone headline, caps eyebrows, arrows,
  trust strip, dashed code boxes, dark-mode CSS and the pill logo. The admin
  badge-label fields were removed. The welcome email links Research
  (Insights moved there). Thumbnails backfilled and assets moved to v5
  (`7916e41`). Pre-order update email added and first sent (`8d98229`).
- Before: a dark hero modelled on the OG image, with a constellation texture,
  badge chips and a purity/testing/shipping strip, with light and dark themes.
