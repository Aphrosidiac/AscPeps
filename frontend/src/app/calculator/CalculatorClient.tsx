'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { SyringeGauge } from '@/components/calculator/SyringeGauge';

const STRENGTH_OPTIONS = [1, 5, 10, 15, 20, 50];
const WATER_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3];
const DOSE_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 7.5, 10, 12.5, 15];

function PillGroup({
  step,
  label,
  unit,
  options,
  value,
  onSelect,
  customValue,
  onCustomChange,
}: {
  step: number;
  label: string;
  unit: string;
  options: number[];
  value: number | null;
  onSelect: (v: number) => void;
  customValue: string;
  onCustomChange: (v: string) => void;
}) {
  const filled = value !== null || customValue !== '';

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
            filled ? 'bg-primary text-white' : 'bg-surface-elevated text-text-muted border border-border'
          )}
        >
          {step}
        </div>
        <h2 className="font-display font-semibold text-lg">{label}</h2>
      </div>
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
  const [strength, setStrength] = useState<number | null>(null);
  const [strengthCustom, setStrengthCustom] = useState('');
  const [water, setWater] = useState<number | null>(null);
  const [waterCustom, setWaterCustom] = useState('');
  const [dose, setDose] = useState<number | null>(null);
  const [doseCustom, setDoseCustom] = useState('');

  const strengthMg = strengthCustom !== '' ? parseFloat(strengthCustom) : strength;
  const waterMl = waterCustom !== '' ? parseFloat(waterCustom) : water;
  const doseMg = doseCustom !== '' ? parseFloat(doseCustom) : dose;

  const validStrength = typeof strengthMg === 'number' && strengthMg > 0;
  const validWater = typeof waterMl === 'number' && waterMl > 0;
  const validDose = typeof doseMg === 'number' && doseMg > 0;

  const concentration = useMemo(
    () => (validStrength && validWater ? strengthMg! / waterMl! : null),
    [validStrength, validWater, strengthMg, waterMl]
  );

  const results = useMemo(() => {
    if (concentration === null || !validDose) return null;
    return {
      units: (doseMg! / strengthMg!) * waterMl! * 100,
      vialDoses: strengthMg! / doseMg!,
    };
  }, [concentration, validDose, doseMg, strengthMg, waterMl]);

  const selectStrength = (v: number) => {
    setStrength(v);
    setStrengthCustom('');
  };
  const selectWater = (v: number) => {
    setWater(v);
    setWaterCustom('');
  };
  const selectDose = (v: number) => {
    setDose(v);
    setDoseCustom('');
  };

  return (
    <div className="space-y-8">
      <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 grid sm:grid-cols-3 gap-6 sm:gap-8">
        <PillGroup step={1} label="Vial Strength" unit="mg" options={STRENGTH_OPTIONS} value={strength} onSelect={selectStrength} customValue={strengthCustom} onCustomChange={setStrengthCustom} />
        <PillGroup step={2} label="Water Added" unit="mL" options={WATER_OPTIONS} value={water} onSelect={selectWater} customValue={waterCustom} onCustomChange={setWaterCustom} />
        <PillGroup step={3} label="Dose" unit="mg" options={DOSE_OPTIONS} value={dose} onSelect={selectDose} customValue={doseCustom} onCustomChange={setDoseCustom} />
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 sm:p-8">
        <h2 className="font-display font-semibold text-xl mb-6 text-center">Results</h2>

        {concentration === null && (
          <p className="text-text-secondary text-center py-8">
            Start with <strong className="text-text-primary">vial strength</strong> and <strong className="text-text-primary">water added</strong> above — that gives you the concentration.
          </p>
        )}

        {concentration !== null && !results && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2 text-center">
              <div className="sm:col-start-2">
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Concentration</p>
                <p className="font-display font-bold text-lg">{concentration.toFixed(2)} mg/mL</p>
              </div>
            </div>
            <p className="text-text-secondary text-center py-4">
              Now pick a <strong className="text-text-primary">dose</strong> above to see how much to draw.
            </p>
          </>
        )}

        {results && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 text-center">
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Concentration</p>
                <p className="font-display font-bold text-lg">{concentration!.toFixed(2)} mg/mL</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Vial Yields</p>
                <p className="font-display font-bold text-lg">{results.vialDoses.toFixed(1)} doses</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Dose</p>
                <p className="font-display font-bold text-lg">{doseMg} mg</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Draw To</p>
                <p className="font-display font-bold text-lg">{results.units.toFixed(2)} units</p>
              </div>
            </div>
            <SyringeGauge units={results.units} />
            <p className="text-xs text-text-muted text-center mt-4">
              Assumes a standard U-100 insulin syringe (100 units = 1mL).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
