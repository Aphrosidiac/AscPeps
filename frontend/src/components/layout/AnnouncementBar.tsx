'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface AnnouncementBarProps {
  enabled: boolean;
  text: string;
}

export function AnnouncementBar({ enabled, text }: AnnouncementBarProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!enabled || dismissed) return null;

  return (
    <div className="bg-primary text-white text-center text-sm sm:text-base py-2 px-8 relative">
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
