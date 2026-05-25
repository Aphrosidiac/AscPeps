'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getSettings } from '@/lib/api';

export function AnnouncementBar() {
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      if (s.announcement_enabled === 'true' && s.announcement_text) {
        setText(s.announcement_text);
        setVisible(true);
      }
    }).catch(() => {});
  }, []);

  if (!visible || dismissed) return null;

  return (
    <div className="bg-primary text-white text-center text-xs sm:text-sm py-2 px-8 relative">
      <p className="font-medium">{text}</p>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded transition-colors cursor-pointer"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
