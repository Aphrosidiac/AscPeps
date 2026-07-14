import { Thermometer, Snowflake } from 'lucide-react';
import { Stagger } from '@/components/ui/Animate';

export function StorageGuidelines() {
  return (
    <Stagger className="grid sm:grid-cols-2 gap-4" stagger={0.06}>
      <div className="bg-surface rounded-xl border border-border p-5">
        <Snowflake className="w-5 h-5 text-blue-500 mb-3" />
        <h3 className="font-medium text-sm mb-1">Unreconstituted (Powder)</h3>
        <ul className="text-sm text-text-secondary space-y-1">
          <li>Freezer (-20°C): up to 24 months</li>
          <li>Refrigerator (2-8°C): up to 6 months</li>
          <li>Room temperature: up to 30 days</li>
        </ul>
      </div>
      <div className="bg-surface rounded-xl border border-border p-5">
        <Thermometer className="w-5 h-5 text-orange-500 mb-3" />
        <h3 className="font-medium text-sm mb-1">Reconstituted (Solution)</h3>
        <ul className="text-sm text-text-secondary space-y-1">
          <li>Refrigerator (2-8°C): up to 30 days (BAC water)</li>
          <li>Refrigerator (2-8°C): up to 48 hours (sterile water)</li>
          <li>Do not freeze reconstituted peptides</li>
        </ul>
      </div>
    </Stagger>
  );
}
