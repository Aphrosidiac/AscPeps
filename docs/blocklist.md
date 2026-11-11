# Blocked customers

Admin → Sales → **Blocked customers** (`/admin/blocked`). Code: `backend/src/utils/blocklist.ts`,
`backend/src/modules/admin/admin-blocklist.*`, `frontend/src/app/admin/blocked/page.tsx`.

## What a block does

A blocked person is a list of identifiers: emails, phones, delivery addresses and IP networks
(an IPv6 address blocks its whole /64; an IPv4 address blocks just itself).

| Where | Matched on | What they see |
|---|---|---|
| Checkout (`POST /orders`) | email, phone, address + postcode, network | "Sorry, we can't accept this request." (403) |
| Sign-up | email, network | the normal "check your inbox" reply; no account, no email |
| Login | email, network | "This account has been suspended." |
| Forgot password | email, network | the normal reply; no email |
| Newsletter | email, network | "subscribed"; nothing stored |
| Group Buy sign-up, affiliate join | email, phone, network | the refusal (403) |
| Any other public API call | network | the refusal (403) |

Pages still load from a blocked network, because they're rendered on our server. Everything the
visitor tries to do from the page fails.

## It learns

When any identifier matches, the request is refused **and everything else in it is added to the
same person**, shown as "Learnt" in the admin. Some examples:

- A known email from a new network: the network is learnt.
- A new email and phone from a known network: both are learnt.

Learnt networks expire 60 days after the person's last attempt from them, because mobile and shared
IPs get reassigned. Emails, phones, addresses and networks typed in by the team never expire.

Every member account whose email is on a person's list is banned (`Member.banned`). Unblocking
deletes the person and un-bans those accounts.

**Block** on Members blocks an account's email plus the phone, address and email of every order
placed with that inbox (Gmail dots and +tags are treated as the same inbox).

## Why not nginx

A network blocked at nginx never reaches the app, so a new email or phone typed from it would never
be learnt. The app does the network blocking itself. The real client IP reaches the API through
Cloudflare → nginx (`cloudflare-realip.conf`) → `X-Forwarded-For`, read with `trustProxy: 1`.

## Fails open

If a blocklist check throws (DB hiccup, bug), the request is allowed and the error is logged.
Checkout must never go down for everyone because of this.
