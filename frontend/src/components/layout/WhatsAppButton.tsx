'use client';

import { MessageCircle } from 'lucide-react';

interface WhatsAppButtonProps {
  /** True on pages with a mobile sticky bottom bar (the product page's Add
   *  to Cart CTA) that this button would otherwise sit on top of. Everywhere
   *  else, bottom-24 just left a gap and overlapped real content lower on
   *  the page instead (cart/checkout totals, the WhatsApp button covering
   *  its own price). */
  raised?: boolean;
}

export function WhatsAppButton({ raised = false }: WhatsAppButtonProps) {
  return (
    <a
      href="https://wa.me/601161092723"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className={`fixed ${raised ? 'bottom-24' : 'bottom-6'} sm:bottom-6 right-4 sm:right-6 z-30 bg-[#25D366] hover:bg-[#1fb855] text-white w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200`}
    >
      <MessageCircle className="w-6 h-6" />
    </a>
  );
}
