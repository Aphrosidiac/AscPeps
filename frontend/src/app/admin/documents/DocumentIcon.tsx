import { FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react';

// Pictures and PDFs from the dashboard; since Oct 2026 also the Excel/CSV
// statements and Word files the assistant files from WhatsApp.
export function DocumentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') return <FileText className="w-4 h-4 text-danger shrink-0" />;
  if (mimeType.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-primary shrink-0" />;
  if (/spreadsheet|excel|csv|tab-separated/.test(mimeType)) return <FileSpreadsheet className="w-4 h-4 text-success shrink-0" />;
  return <FileText className="w-4 h-4 text-text-secondary shrink-0" />;
}
