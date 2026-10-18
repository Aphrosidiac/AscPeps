# Cold email plan

Outbound email to people who never signed up, using leads scraped with Apify.
This is a separate system from [email-campaigns.md](email-campaigns.md), which
mails Ascend's own subscribers and customers. Planned 18 Oct 2026; nothing is
bought or built yet.

**Open question before building:** who the leads are and what they are offered.
The B2B fork (AscendB2B) was cancelled on 17 Oct 2026, so the offer has to be
decided first: clinics or gyms buying stock, coaches referring clients, or
something else. It decides the search terms and the first email.

## The rule: never from ascendpeptides.my or its Resend account

Order confirmations and payment receipts share the Resend account with
campaigns. Resend's acceptable-use policy prohibits mass unsolicited mail, and
it can close an account without warning above roughly 0.08% complaints. One bad
scraped batch would stop every order email.

Cold email gets its own domains, its own mailboxes and its own sending tool.
Nothing in a cold email links to ascendpeptides.my: filters score the domains
in links, not only the sender, so a cold batch that lands the store domain on
Spamhaus DBL or URIBL would bury the newsletter and order emails too. Send no
link, or one link on the cold domain.

## Setup

### 1. Domains

Lookalike `.com` domains (e.g. `ascendmy.com`, `getascendmy.com`,
`ascend-my.com`), each 301-redirecting to ascendpeptides.my, on Cloudflare
Registrar with auto-renew on.

- **`.com` only** (`.net` / `.co` at a pinch). No cheap TLDs: `.xyz`, `.top`,
  `.click`, `.icu`, `.cfd`, `.sbs`, `.bond`, `.online`, `.site`, `.shop`. They
  have the worst abuse ratios, filters score the TLD, and some company mail
  systems block them outright. The saving is about US$5 a domain a year,
  against the US$7 a month each inbox costs.
- **Names:** brandable Ascend variants. No `peptide`, `pharma`, `health`,
  `mail` or `outreach`, no digits, at most one hyphen.
- **Live + reserve, not "lots":** 3 live domains (6 inboxes) plus 2 reserve
  domains (4 inboxes) warming continuously, about 10 inboxes in all. A burned
  live domain is swapped for a warm reserve the same day, and a new reserve
  starts warming. Spare domains can be bought early (age helps, US$10 each)
  but get inboxes only when they join the rotation.
- **Two providers:** live and reserve split across Google Workspace and
  Microsoft 365, so one suspended account doesn't take every inbox with it.
- More domains don't fix a first batch that fails on a bad list or bad copy:
  new domains burn the same way. The first batch starts slow on purpose.

### 2. Mailboxes

Google Workspace (or a Google + Microsoft 365 mix), 2–3 inboxes per domain.
Each is a real person's name with a photo and a signature. No cheap SMTP relays
or shared IPs.

### 3. DNS, per domain

| Record | Value |
|---|---|
| SPF | `v=spf1 include:_spf.google.com ~all` |
| DKIM | 2048-bit key |
| DMARC | `p=none` with `rua=` reporting at first, `p=quarantine` after about 4 weeks clean. The From domain must align with the signing domain. |
| Tracking | Custom tracking domain via CNAME, if the tool tracks anything |

Unauthenticated mail to Gmail can be rejected with `5.7.26`.

### 4. Warm-up

Warm-up mail never goes to leads. Instantly's warm-up network is a pool of
other users' real inboxes: ours trade automated emails with them, and the
receiving side opens them, replies, marks them important and pulls them out
of spam. Gmail and Microsoft see a new inbox with a normal, engaged history.
Warm-up messages carry a tag that a filter in each inbox uses to hide them.

| Weeks | Warm-up / inbox / day | Real lead emails / inbox / day |
|---|---|---|
| 1–3 | +1 a day up to the daily limit (Instantly suggests 10 for new inboxes, later about 20) | **0** |
| 4 | 10–20 | 5–10 |
| 5–6 | 10–20 | +5 a week |
| 7+ | stays on, permanently | ceiling **25–30** |

Warm-up cannot rescue a bad list: real replies and low complaints are what
keep the reputation. If bounces or complaints rise, cut real sends and let
warm-up carry the inbox.

At the ceiling, 3 domains × 2 inboxes × 25 = about 150 lead sends a day,
follow-ups included.

### 5. Sending tool: Instantly

Chosen 18 Oct 2026. Covers sending, inbox rotation, throttling, stop on reply
or bounce, unlimited inboxes and warm-up, the blocklist (suppression list),
Unibox replies, and email verification on credits (about 0.25 credit per
address).

- **Plan:** Outreach Growth, $47/mo ($37.60/mo yearly): 5,000 emails and
  1,000 uploaded contacts a month. Warm-up is listed as unlimited, separate
  from the 5,000 (confirm with Instantly chat before paying). The 5,000 counts
  every campaign email, follow-ups included; the 1,000 contacts is the real
  cap (1,000 leads × 3 steps ≈ 3,000 emails). Enough for the pilot only. Move to
  Hypergrowth ($97/mo, 25,000 contacts) once replies prove out.
- **No Credits or bundle plan at first.** Leads come from Apify; verification
  from Apify's add-on or a small credit top-up.
- **Own the inboxes; skip Instantly's pre-warmed ones.** Those ($10/inbox/mo,
  $15/domain/yr, batches of 5) send from day one, but Instantly keeps the
  domains and admin access and can't transfer them. Its terms allow
  suspension at its sole discretion, and peptides are a category platforms get
  nervous about. Domains on Cloudflare and Workspace inboxes we own, connected
  to Instantly, can move to Smartlead in an afternoon.
- **Not in Instantly:**
  - Malaysian gym and clinic leads: SuperSearch is Apollo-style (450M
    contacts, Malaysia coverage unstated). Apify Google Maps → CSV → Instantly.
  - AscPeps customers and unsubscribers: export and upload to Instantly's
    blocklist before the first send (manual until automated).
  - Postmaster Tools and blocklist checks stay outside.
- **Pilot cost:** about US$47 Instantly + about US$42 for 6 Workspace inboxes
  + domains + a few dollars of Apify ≈ **US$95/mo**.

### 6. List hygiene

Where scraped lists go wrong.

- Every address goes through a verifier before it enters the tool. Drop
  invalid and disposable; catch-all addresses only in small doses. Scraped
  lists carry spam traps, which is how senders land on Spamhaus.
- Remove existing customers and every address that ever unsubscribed from the
  AscPeps list. Mailing an opted-out customer from a new domain is the fastest
  complaint there is.

### 7. Content

Filters are hard on GLP-1 and weight-loss pharma spam.

- The first email names no peptide (retatrutide, tirzepatide…), no dosing, no
  prices, no "weight loss", no "GLP-1".
- Plain text, no images, no attachments, no open-tracking pixel, at most one
  link, about 80 words, a personalised first line.
- At most three steps. Products come up only after a reply, or move to
  WhatsApp.
- Ends with an opt-out ("Reply 'no' and I won't email again") and says who is
  writing.
- Research-use-only framing, no health claims.

### 8. Monitoring

- Every cold domain in Google Postmaster Tools.
- Weekly blocklist check (MXToolbox, Spamhaus).
- Auto-pause above 2% bounces or 0.1% complaints. Google's hard line is 0.3%;
  stay well under it.
- A burned domain is retired and replaced, never rescued by sending from the
  main one.

### What this protects against

| Risk | Cause | Guard |
|---|---|---|
| Resend ban, order emails stop | Cold mail on the store's account | Separate system |
| Store domain blocklisted | Store links in cold mail | No store links |
| Spamhaus listing | Spam traps in scraped lists | Verify, limit catch-alls |
| Workspace accounts suspended | Complaint spikes | Low per-inbox volume, clean lists |
| Legal and reputation | PDPA right to refuse direct marketing; unregistered peptides in writing to strangers | Honour opt-outs at once, no health claims |

### Rough cost

Domains a few dollars a month each, Workspace about US$7–8 per inbox per month,
Instantly about US$37 a month. With 6 inboxes, about **US$90–100 a month**.

## Apify actors

Apollo-style databases cover Malaysian small businesses poorly, so Google Maps
comes first for the likely targets.

| Target | Actor | Notes |
|---|---|---|
| Gyms, fitness studios, aesthetic / wellness / anti-ageing clinics, supplement shops (**recommended start**) | `compass/crawler-google-places` (Google Maps Scraper), 4.7★, ~655K users, from $1.50 / 1K places | Turn on `scrapeContacts` (emails and socials from the business website) and the email verification add-on. |
| Named owners at larger chains (gym franchises, clinic groups) | `code_crafter/leads-finder`, 3.4★, ~49K users, $1.50 / 1K | Filters by title, seniority, industry, country, company size. Malaysian coverage unconfirmed: test 100 leads first. Free plan caps runs at 100. |
| A company list already in hand | `vdrmota/contact-info-scraper` | Website domains in, emails and socials out. Mostly role addresses. |

### Google Maps input

- **Search terms:** `gym`, `fitness studio`, `aesthetic clinic`,
  `wellness clinic`, `anti aging clinic`, `supplement store`,
  `personal trainer`
- **Locations, one run each:** Kuala Lumpur, Petaling Jaya, Shah Alam,
  Subang Jaya, Johor Bahru, Penang, Ipoh, Melaka
- **Filters:** has a website, at least 4.0★, skip closed; dedupe by `placeId`

### Caveats

- Google Maps emails are mostly `info@`. Lower reply rates; keep volume low on
  them.
- "Verified" means different things per actor. Run everything through our own
  verifier regardless.
- Individual consumers are not a cold-email target. No legitimate actor yields
  consumer emails, and unsolicited marketing to individuals is the plainest
  PDPA case. TikTok and the newsletter stay the consumer channels.

## Sources

- [Google email sender guidelines](https://support.google.com/a/answer/81126)
- [Resend Acceptable Use Policy](https://resend.com/legal/acceptable-use)
- [Google Maps Scraper (Apify)](https://apify.com/compass/crawler-google-places)
- [Leads Finder, code_crafter (Apify)](https://apify.com/code_crafter/leads-finder)
- [Leads Finder, atomus (Apify)](https://apify.com/atomus/leads-finder)
- [Best Apify actors for lead generation](https://use-apify.com/docs/best-apify-actors/best-lead-generation-actors)
- [Instantly pricing](https://instantly.ai/pricing)
- [Instantly pre-warmed accounts](https://help.instantly.ai/en/articles/9969215)
- [Instantly SuperSearch](https://help.instantly.ai/articles/11364248-supersearch)
- [Instantly terms](https://instantly.ai/terms)
- [Spam domains by TLD, Mar–May 2026 (CybercrimeInfoCenter)](https://www.cybercrimeinfocenter.org/spam-activity-in-tlds-march-may-2026)
- [Instantly 2026 deliverability guide](https://instantly.ai/blog/how-to-achieve-90-cold-email-deliverability-in-2025/)
- [Google & Microsoft sender guidelines 2026](https://leadhaste.com/blog/google-microsoft-sender-guidelines)
- [Microsoft cold email policy 2026](https://litemail.ai/blog/microsoft-cold-email-policy-2026)
- [Deloitte on Malaysia PDPA amendments](https://www.deloitte.com/southeast-asia/en/services/risk-advisory/perspectives/my-pdpa-amendments.html)
