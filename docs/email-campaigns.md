# Email campaigns

Marketing email to the list: a campaign is written in Admin → Campaigns,
previewed live, test-sent, then sent to an audience the admin can see person
by person. Transactional mail (order confirmations, payment receipts) is a
separate system that shares the same Resend account. See the quota note at the
end.

First live send: **13 Oct 2026, "Retatrutide: 30 left"**, to 67 people (All
customers, minus open orders). All 67 sent with 0 errors and 65 confirmed
delivered within a minute.

## Switches

All of these live in `settings`, and an absent row means **off**.

| Key | Gates |
|---|---|
| `emails_enabled` | All mail. Turning this off also stops marketing. |
| `marketing_emails_enabled` | Campaign sends. On since 13 Oct 2026. |
| `welcome_emails_enabled` | The welcome email to new subscribers. **Off.** The list is mailed through campaigns only. |

Turning `welcome_emails_enabled` on sends a welcome to every subscriber who
never had one, however long ago they joined (25 were pending on 13 Oct). Clear
that backlog first. Subscribers with source `ORDER` never get a welcome.

## What a campaign is

`campaigns` row. Everything except `name` is what the recipient sees.

| Field | Where it shows |
|---|---|
| `subject`, `preheader` | Inbox line. A blank preheader falls back to the opening of the body. |
| `badge`, `headline`, `subhead` | The black hero. A blank `headline` falls back to the subject. |
| `body` | Plain text. Blank lines become paragraphs. It is escaped, so no HTML can reach a bulk send. |
| `ctaLabel` + `ctaUrl` | One button. Both halves are needed, otherwise no button. |
| `productIds` | Featured products in order. The first is the large spotlight card; the rest form a two-up grid. Max 7. |
| `audience` + `exclude*` | Who gets it. See Audience below. |

Product cards store **ids only**. Name, photo, price and stock are read at
send time (`loadCampaignProducts`), so a draft never quotes a stale price. The
price is the cheapest size that is **in stock** (sale applied; if no size is,
the cheapest of all), and the photo is that size's photo, falling back to the
product's first image. Inactive products, and products with no active size, are
skipped.

The composer shows the guidance this campaign was planned around: subjects of
30 characters or fewer, bodies of 100 words or fewer. These come from a study
of 6,337 cold emails. They are guidance, never enforced.

## The template (`backend/src/emails/campaign.ts`)

Built on the shared table layout in `emails/layout.ts`: the dark hero, the
dark-mode rules, and the Outlook-safe button.

- **Spotlight:** full-width photo, stock line, name, sizes, price, and a SHOP
  NOW button.
- **Grid:** a fixed 48% / 4% / 48% table that never stacks, so it holds even
  in the Gmail app for non-Google accounts, which strips `<style>`. Each pair
  is two table rows (pictures, then details), so the cells in a row are equal
  height in every client.
- **No photo:** a typeset label tile on black ("FOR RESEARCH PURPOSES ONLY",
  name, size), stretched to the neighbouring photo's height by the table row.
- **Stock wording** comes from the real number: "In stock", "Only N left"
  (5 or fewer), or "Sold out" (no green dot).
- **Trust strip** (purity / tested / shipping) is shown when products are
  featured.
- **Footer** says truthfully why the person is on the list: "signed up for
  updates", or "you've ordered from Ascend MY" for `ORDER` subscribers. Then
  the visible unsubscribe link.
- **Every send** also carries a plain-text part and the RFC 8058
  List-Unsubscribe pair.
- **Store links** are UTM-tagged automatically: `utm_source=newsletter`,
  `utm_medium=email`, `utm_campaign=<slug of the internal name>`. Links
  already tagged, or to other sites, are left alone.

### Card photos (`.card.jpg`)

Product uploads are stored as WebP, which older Outlook can't render. Every
upload writes two JPEG siblings: `<id>.email.jpg` (160px, order-line thumbs)
and `<id>.card.jpg` (640×512, campaign cards).

The card crop is measured, not "smart": on the studio shots at 640px, the vial
cap starts at y=123 and the corner pill mark ends at y=599. The 512px window
starts 82% of the way into the spare height (y=105), keeping both with equal
margins. sharp's `attention` crop cut the cap off.

Backfill for existing images, run on the box from `backend/`:

```bash
node scripts/generate-email-thumbs.mjs            # add --dry-run first, --force to rewrite
```

## Audience (`buildRecipients` in `admin-campaigns.controller.ts`)

One function resolves who gets a campaign, and the composer's list, every
count, the send button, the confirmation dialog and the send itself all use
it. The number on screen is the number that goes out.

**Base audience:**

| Value | Who |
|---|---|
| `CUSTOMERS` | Every subscribed row (signups, plus order customers a past campaign already reached who have not opted out), plus every paid customer with no subscriber row. |
| `ALL` | Every subscriber who **signed up**. |
| `BUYERS` / `NON_BUYERS` | Signed-up subscribers with / without a paid order. |

Only `CUSTOMERS` reaches order customers. The subscriber rows a `CUSTOMERS` send
creates (source `ORDER`, below) are contacts, not subscriptions: `ALL`, `BUYERS`
and `NON_BUYERS` skip them, so a customer campaign going out never makes
"Everyone" bigger. Signing up through a form, or being added by hand, turns the
row into a real subscriber.

Paid customers are matched by order email (lowercased), because most orders
are placed without an account. An address that ever unsubscribed has a row,
so the customer list can never bring it back in.

**Exclusions**, applied on top. Each person is tagged with the first rule that
removes them:

1. `excludeEmails`: specific people, stored lowercased. Checked first because
   it is the most deliberate.
2. `excludeOrderedWithinDays`: a paid order in the last N days.
3. `excludeOpenOrders`: a paid order still on its way (PENDING / CONFIRMED /
   SHIPPED).
4. `excludeBoughtProductIds`: ever bought any of these products.

**At send:** customers without a row get a subscriber row with source `ORDER`,
so they carry an unsubscribe token and an opt-out sticks. Those rows are kept
(deleting one would orphan the unsubscribe link already in the customer's inbox
and the campaign's delivery record), but they are hidden from the Subscribers
list, its numbers and its CSV export; they have their own **Customers emailed**
tab there (reachable vs opted out, the campaigns that reached each, an opt-out
action, no delete). The audience is
snapshotted into `campaign_recipients` once, so people who join mid-send are
not mailed. The (campaign, subscriber) unique key makes a double-submit
harmless.

## Sending

The worker (`utils/marketing-worker.ts`) runs every 60s, sends up to 40 per
run at 550 ms apart, and reads products once per campaign per run. Retries
back off at 1m, 5m, 30m and 2h, then mark the row FAILED. A sent campaign is a
read-only record (Delivered / Still queued / Failed). Bounces and spam reports
from the Resend webhook unsubscribe the address.

## Admin

- **Campaigns list:** a card per campaign showing its real rendered email
  (`components/admin/EmailPreview.tsx`, `mode="thumb"`), plus status, subject,
  inbox line and audience.
- **Campaign page:** six numbered steps (Inbox, Header, Message, Products,
  Audience, Test & send) beside a sticky preview. The preview has the inbox
  row, desktop/phone width, and subscriber/order-customer footer toggles. It
  is the server's own render (`GET /admin/campaigns/:id/preview`).
- **Autosave:** typing saves after 900 ms; blur saves at once.
- **Audience step** (`AudiencePanel.tsx`): base options with live sizes, group
  rules with "−N" counts, exclude-by-address, and the searchable recipient
  list (`GET /admin/campaigns/:id/audience`) with per-person Exclude/Include.
- **Subscribers → Customers emailed:** the contacts above, apart from the real
  list. Export CSV follows the active tab.
- **Send:** needs SEND typed into a confirmation that states the final count,
  the order customers added, and the number excluded.

## Traps found while building it

- **zod 4 applies `.default()` inside `.partial()`.** The update schema was
  `campaignSchema.partial()`, so a PATCH that only cleared the badge reset the
  audience to ALL. A send would have gone to 24 people instead of 74. The
  update schema is now built from the fields without the default.
- **Optional fields could not be cleared.** `''` was sent as `undefined` and
  dropped. Clearable fields now accept `null`.
- **A single-column grid without `grid-cols-1`** has an implicit auto track
  that grows to fit the longest email address. The editor overflowed on
  narrow screens.
- **Test sends to `@resend.dev` sinks count against the Resend daily quota.**
  See below.

## Resend quota

Order emails and campaigns share one Resend account and its daily quota. On
send day the quota was hit by the campaign plus local test sends. The
campaign itself finished, but order emails fail until the reset. They retry
for about 2.5h, after which "Retry failed" on Admin → Emails resends them.

Local testing may use the production key, but send only enough to prove a
thing works: one test, and a bulk test to 3–5 sink addresses, never the whole
list. Avoid local send tests on a campaign day.
