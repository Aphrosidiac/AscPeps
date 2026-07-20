'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Check, ShoppingCart } from 'lucide-react';

interface CartToastProps {
  item: { code: string; name: string; key: number } | null;
  onDone: () => void;
}

export function CartToast({ item, onDone }: CartToastProps) {
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState<{ code: string; name: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!item) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (fadeRef.current) clearTimeout(fadeRef.current);

    setDisplay({ code: item.code, name: item.name });
    setVisible(true);

    timerRef.current = setTimeout(() => {
      setVisible(false);
      fadeRef.current = setTimeout(onDone, 300);
    }, 2500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeRef.current) clearTimeout(fadeRef.current);
    };
  }, [item, onDone]);

  if (!display) return null;

  return (
    <div className={`fixed top-20 right-4 sm:right-6 z-50 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
      <div className="bg-surface border border-border rounded-xl shadow-lg p-4 flex items-center gap-3 max-w-xs">
        <div className="w-10 h-10 bg-success/10 rounded-full flex items-center justify-center shrink-0">
          <Check className="w-5 h-5 text-success" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-display font-bold truncate">{display.code}</p>
          <p className="text-xs text-text-muted truncate">{display.name}</p>
        </div>
        <Link
          href="/cart"
          className="shrink-0 p-2 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors"
        >
          <ShoppingCart className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
