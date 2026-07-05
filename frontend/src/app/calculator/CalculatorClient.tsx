'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { SyringeGauge } from '@/components/calculator/SyringeGauge';

const DOSE_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 7.5, 10, 12.5, 15];
const STRENGTH_OPTIONS = [1, 5, 10, 15, 20, 50];
const WATER_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3];

function PillGroup({
  label,
  unit,
  options,
  value,
  onSelect,
  customValue,
  onCustomChange,
}: {
  label: string;
  unit: string;
  options: number[];
  value: number | null;
  onSelect: (v: number) => void;
  customValue: string;
  onCustomChange: (v: string) => void;
}) {
  return (
    <div>
      <h2 className="font-display font-semibold text-lg mb-3">{label}</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={cn(
              'px-4 py-2 rounded-full border text-sm font-medium transition-colors',
              value === opt && customValue === ''
                ? 'bg-primary text-white border-primary'
                : 'bg-surface border-border hover:border-border-hover text-text-primary'
            )}
          >
            {opt}
            {unit}
          </button>
        ))}
      </div>
      <Input
        placeholder={`Custom ${label.toLowerCase()} (${unit})`}
        type="number"
        min="0"
        step="any"
        value={customValue}
        onChange={(e) => onCustomChange(e.target.value)}
      />
    </div>
  );
}

export function CalculatorClient() {
  const [dose, setDose] = useState<number | null>(null);
  const [doseCustom, setDoseCustom] = useState('');
  const [strength, setStrength] = useState<number | null>(null);
  const [strengthCustom, setStrengthCustom] = useState('');
  const [water, setWater] = useState<number | null>(null);
  const [waterCustom, setWaterCustom] = useState('');

  const doseMg = doseCustom !== '' ? parseFloat(doseCustom) : dose;
  const strengthMg = strengthCustom !== '' ? parseFloat(strengthCustom) : strength;
  const waterMl = waterCustom !== '' ? parseFloat(waterCustom) : water;

  const results = useMemo(() => {
    const validDose = typeof doseMg === 'number' && doseMg > 0;
    const validStrength = typeof strengthMg === 'number' && strengthMg > 0;
    const validWater = typeof waterMl === 'number' && waterMl > 0;

    if (!validDose || !validStrength || !validWater) return null;

    return {
      units: (doseMg / strengthMg) * waterMl * 100,
      concentration: strengthMg / waterMl,
      vialDoses: strengthMg / doseMg,
    };
  }, [doseMg, strengthMg, waterMl]);

  const selectDose = (v: number) => {
    setDose(v);
    setDoseCustom('');
  };
  const selectStrength = (v: number) => {
    setStrength(v);
    setStrengthCustom('');
  };
  const selectWater = (v: number) => {
    setWater(v);
    setWaterCustom('');
  };

  return (
    <div className="space-y-8">
      <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 grid sm:grid-cols-3 gap-6 sm:gap-8">
        <PillGroup label="Dose" unit="mg" options={DOSE_OPTIONS} value={dose} onSelect={selectDose} customValue={doseCustom} onCustomChange={setDoseCustom} />
        <PillGroup label="Vial Strength" unit="mg" options={STRENGTH_OPTIONS} value={strength} onSelect={selectStrength} customValue={strengthCustom} onCustomChange={setStrengthCustom} />
        <PillGroup label="Water Added" unit="mL" options={WATER_OPTIONS} value={water} onSelect={selectWater} customValue={waterCustom} onCustomChange={setWaterCustom} />
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 sm:p-8">
        <h2 className="font-display font-semibold text-xl mb-6 text-center">Results</h2>

        {results ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 text-center">
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Dose</p>
                <p className="font-display font-bold text-lg">{doseMg} mg</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Draw To</p>
                <p className="font-display font-bold text-lg">{results.units.toFixed(2)} units</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Vial Yields</p>
                <p className="font-display font-bold text-lg">{results.vialDoses.toFixed(1)} doses</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Concentration</p>
                <p className="font-display font-bold text-lg">{results.concentration.toFixed(2)} mg/mL</p>
              </div>
            </div>
            <SyringeGauge units={results.units} />
            <p className="text-xs text-text-muted text-center mt-4">
              Assumes a standard U-100 insulin syringe (100 units = 1mL).
            </p>
          </>
        ) : (
          <p className="text-text-secondary text-center py-8">Select a dose, vial strength, and water volume above to see your results.</p>
        )}
      </div>
    </div>
  );
}
