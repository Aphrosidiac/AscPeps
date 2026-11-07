# Analytics

`/admin/analytics` reports on any period: this month, 7, 30 or 90 days, 6 or 12 months,
all time, one picked month or custom dates. The period sits in the address, so a reload
or a shared link lands on the same view. Every period comes from one request,
`GET /api/v1/admin/dashboard/analytics/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD`, in
Malaysian days. The sums are pure and tested (`backend/src/utils/analytics-model.ts`,
`utils/forecast.ts`, `npm run test:analytics`); `admin-analytics.controller.ts` only
loads the rows.

The rolling `getAnalytics` stays for the assistant's `sales_analytics` tool.

## The rules

The books' rules, unchanged (see `bookkeeping.md`): an order belongs to the month it
was placed in, money in is PAID or REFUNDED, every figure comes from `costOrder`, and
profit only covers fully costed orders. Margin is measured against those orders' own
revenue, and what is not costed is shown, never estimated into profit.

- **Profit** on this page is profit on orders, after goods, courier and extras,
  gateway fees and affiliate commission. **Net** then takes off operating expenses.
  Stock bought is an INVENTORY expense, so it is shown but is not a cost until sold.
- A customer is a normalised phone number. A repeat order the same day is not a gap.
- New and returning revenue is judged per order: a customer's first ever order is new,
  every order after it is returning, even in the same period.
- A running month is compared with the same number of days of the month before. A
  whole calendar month is compared with the month before it. Any other period is
  compared with the same number of days immediately before it.
- **Marketing** is any operating expense whose category reads like marketing or ads
  (`MARKETING_CATEGORY`). Cost per new customer depends on those being recorded.

## Tabs

- **Overview**, for the chosen period: revenue, profit, orders and average order against
  the comparison period, a chart (by day up to 100 days, then by month with the forecast
  ahead), the sortable month table with CSV, profit and loss,
  customers, products, payment, sources, states, when people buy, orders to door,
  profit share.
- **Customers**, always lifetime: repeat rate, reorder gap, 12-month value, retention by first-order
  month, segments, who is due to reorder, who is at risk.
- **Products**: ABC ranking over the chosen period (the product that crosses 80% is
  still an A), plus stock cover, which always reads the last 60 days, reorder quantities, stock not selling, products bought together.
- **Forecast**: month landing, next 3 months, break-even, what-if, stock running out.

## How the forecasts work

**Month landing.** The rest of the month is simulated 4,000 times by resampling real
days from the last 8 weeks, RM0 days included and recent days weighted higher. The
figure is the mean, because the median of skewed sales reads low every month, and the
range is the 10th to 90th percentile. It is seeded, so a reload does not move it.

**Next 3 months.** Three simple models (latest month, 3-month average, damped trend)
are replayed over the store's own months: fit on the months before, predict the next,
score it. The closest wins, and the range comes from its own misses. The page states
the typical miss beside the score for simply repeating last month. With fewer than 3
replays it uses the average, says it cannot test accuracy, and shows a wide range.

**12-month value** is average order × orders per customer per month × 12. **Stock
demand** weighs the last 30 days 65% and the 30 before 35%, and leaves out Group Buy
lines, which are bought after the batch closes. Reorder quantities top up to 45 days.

## What it cannot do

Forecasts read past sales only: no seasonality yet, and no knowledge of promotions,
Ramadan, supply gaps or new products. Visitor conversion rate needs PostHog read
access, which the backend does not have. Benchmarks are the store's own past months,
not outside industry figures.
