'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetMonthlyAnalytics } from '@/lib/api';
import { TabBar } from '@/components/admin/ui';
import { cn } from '@/lib/utils';
import { dmMono } from './fonts';
import type { AnalyticsReport } from './types';
import { PeriodBar, periodFromQuery, periodToQuery, resolvePeriod, type Period } from './PeriodBar';
import { OverviewTab } from './OverviewTab';
import { CustomersTab } from './CustomersTab';
import { ProductsTab } from './ProductsTab';
import { ForecastTab } from './ForecastTab';

type Tab = 'overview' | 'customers' | 'products' | 'forecast';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'products', label: 'Products' },
  { id: 'forecast', label: 'Forecast' },
];

function fromLocation(): { tab: Tab; period: Period } {
  if (typeof window === 'undefined') return { tab: 'overview', period: { kind: 'preset', key: 'month' } };
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  return { tab: TABS.some((t) => t.id === tab) ? (tab as Tab) : 'overview', period: periodFromQuery(params) };
}

export default function AdminAnalyticsPage() {
  const { token } = useAuth();
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(() => fromLocation().tab);
  const [period, setPeriod] = useState<Period>(() => fromLocation().period);
  const latest = useRef(0);

  const fetchReport = useCallback(() => {
    if (!token) return;
    const request = ++latest.current;
    adminGetMonthlyAnalytics(token, resolvePeriod(period))
      .then((res: AnalyticsReport) => {
        // A slower, older answer must not overwrite the period now on screen.
        if (request !== latest.current) return;
        setReport(res);
        setBusy(false);
      })
      .catch(() => {
        if (request !== latest.current) return;
        setError(true);
        setBusy(false);
      });
  }, [token, period]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // The view lives in the address, so a reload or a shared link lands on it.
  useEffect(() => {
    const query = [tab === 'overview' ? '' : `tab=${tab}`, periodToQuery(period)].filter(Boolean).join('&');
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [tab, period]);

  const choose = (next: Period) => {
    setBusy(true);
    setPeriod(next);
  };

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-text-secondary">Analytics could not be loaded.</p>
        <button type="button" onClick={() => { setError(false); fetchReport(); }} className="cursor-pointer text-sm font-medium text-primary underline">
          Try again
        </button>
      </div>
    );
  }

  if (!report?.period) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-32 rounded-[8px] bg-surface-elevated" />)}
        </div>
        <div className="h-80 rounded-[8px] bg-surface-elevated" />
      </div>
    );
  }

  const current = report.period;
  // Tabs differ in length, so a new tab always starts from the top.
  const openTab = (next: Tab) => {
    setTab(next);
    window.scrollTo(0, 0);
  };
  const openMonth = (month: string) => {
    setTab('overview');
    choose({ kind: 'month', month });
  };

  return (
    <div className={dmMono.variable}>
      {/* One height on every tab, whether or not the period bar is showing. */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-border lg:h-[52px] lg:flex-nowrap">
        <TabBar tabs={TABS} current={tab} onSelect={openTab} className="mb-0! shrink-0 border-b-0! [scrollbar-width:none]" />
        {(tab === 'overview' || tab === 'products') && <PeriodBar period={period} months={report.months} onChange={choose} busy={busy} />}
      </div>

      <div className={cn('transition-opacity duration-100', busy && 'opacity-60')}>
        {tab === 'overview' && <OverviewTab report={report} m={current} onOpenMonth={openMonth} onForecast={() => openTab('forecast')} />}
        {tab === 'customers' && <CustomersTab report={report} />}
        {tab === 'products' && <ProductsTab report={report} />}
        {tab === 'forecast' && <ForecastTab report={report} />}
      </div>
    </div>
  );
}
