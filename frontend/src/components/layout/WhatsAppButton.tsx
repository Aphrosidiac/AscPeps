'use client';

import { MessageCircle } from 'lucide-react';

export function WhatsAppButton() {
  return (
    <a
      href="https://wa.me/601161092723"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 bg-[#25D366] hover:bg-[#1fb855] text-white w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
    >
      <MessageCircle className="w-6 h-6" />
    </a>
  );
}
