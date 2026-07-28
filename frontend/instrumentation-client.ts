import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

// Where events are ingested. Defaults to PostHog's EU region: this store
// serves Malaysian customers under the PDPA, and EU ingestion is the more
// defensible of the two hosted options. Must match the region the project
// token was actually issued in — a US token pointed at the EU host silently
// drops every event.
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

// Optional same-origin path (set to "/ingest" in production) proxied to
// PostHog by nginx. Keeps ingestion on ascendpeptides.my so tracker blockers
// don't quietly eat a chunk of the data. Deliberately proxied at nginx and
// NOT via Next rewrites: nginx already fronts every request, whereas routing
// analytics through the Next process would add load to a box already deep
// into swap — and the Next-rewrite approach also requires flipping
// `skipTrailingSlashRedirect`, a global URL-canonicalisation change this
// site's SEO work can't absorb for the sake of one proxy path.
// Left unset in local dev, where there is no nginx, so we talk to PostHog
// directly instead of 404ing into the Next router.
const proxy = process.env.NEXT_PUBLIC_POSTHOG_PROXY;

if (token) {
  try {
    posthog.init(token, {
      api_host: proxy || host,
      // Where "open in PostHog" links point. Ingestion and the dashboard are
      // different hostnames; this only affects link targets, not data.
      ui_host: host.replace("://eu.i.", "://eu.").replace("://us.i.", "://us."),
      defaults: "2026-06-25",
      capture_exceptions: true,

      // --- Privacy ---
      // Checkout collects name, phone, address and email. Session replay is
      // disabled here in code rather than left to the project's UI toggle,
      // because that toggle applies to the already-deployed script: without
      // this line, someone enabling replay in the PostHog dashboard would
      // start recording the checkout form with no code change and no review.
      disable_session_recording: true,
      // Strips PII-shaped values (emails, names, addresses, card-like
      // numbers) out of autocaptured properties and URLs before they leave
      // the browser.
      mask_personal_data_properties: true,
      // Belt-and-braces on the pages that actually handle customer data:
      // never send the raw URL or referrer, which is where an order number or
      // a phone number would most plausibly leak via a query string.
      // (before_send, not the older sanitize_properties — that name is
      // deprecated in this version and warns on every init.)
      before_send: (event) => {
        if (!event) return event;
        const url = String(event.properties?.$current_url || "");

        // Staff aren't customers: drop admin events outright so internal
        // clicks never pollute the storefront funnels and no order PII shown
        // in that UI is ever transmitted. Done here rather than with
        // opt_out_capturing() because that persists to localStorage — closing
        // the browser on an admin page would leave that browser permanently
        // opted out of storefront analytics with no way back.
        if (url.includes("/admin")) return null;

        const sensitive = ["/checkout", "/track"];
        if (url && sensitive.some((p) => url.includes(p))) {
          event.properties = {
            ...event.properties,
            $current_url: new URL(url, "https://ascendpeptides.my").pathname,
            $referrer: undefined,
            $referring_domain: undefined,
          };
        }
        return event;
      },

      // Person profiles are created for anonymous visitors too. This is
      // required, not incidental: the `purchase` event is emitted server-side
      // once payment actually clears, and is stitched onto the browsing
      // session via posthog.alias() at checkout. Switching this to
      // "identified_only" turns off the person processing that alias depends
      // on and silently breaks every funnel at the purchase step.
      person_profiles: "always",

      debug: process.env.NODE_ENV === "development",
    });
  } catch (err) {
    // This runs before hydration, and Next warns if it exceeds 16ms —
    // analytics must never be able to break the page.
    console.error("PostHog init failed", err);
  }
} else if (process.env.NODE_ENV !== "production") {
  console.error(
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is missing — PostHog events are being silently dropped. Set it in frontend/.env.local (see .env.example)."
  );
}
