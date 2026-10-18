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

2–3 lookalike `.com` domains (e.g. `ascend-my.com`, `getascendmy.com`), each
301-redirecting to ascendpeptides.my.

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

2–3 weeks before the first real send, on the sending tool's warm-up network.
Start at 5–10 a day per inbox and ramp to a ceiling of about **25–30 per inbox
per day**. Warm-up stays on permanently.

3 domains × 2 inboxes × 25 = about 150 sends a day, follow-ups included.

### 5. Sending tool

Instantly or Smartlead: inbox rotation, throttling, stop on reply or bounce,
suppression list.

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
- [Instantly 2026 deliverability guide](https://instantly.ai/blog/how-to-achieve-90-cold-email-deliverability-in-2025/)
- [Google & Microsoft sender guidelines 2026](https://leadhaste.com/blog/google-microsoft-sender-guidelines)
- [Microsoft cold email policy 2026](https://litemail.ai/blog/microsoft-cold-email-policy-2026)
- [Deloitte on Malaysia PDPA amendments](https://www.deloitte.com/southeast-asia/en/services/risk-advisory/perspectives/my-pdpa-amendments.html)
