'use client';

import { useMemo, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { SyringeGauge } from '@/components/calculator/SyringeGauge';

// Trim trailing zeros (e.g. 0.2500 -> 0.25) while still rounding to a sane precision.
function formatMg(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

const STRENGTH_OPTIONS = [1, 5, 10, 15, 20, 50];
const WATER_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3];
const DOSE_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 7.5, 10, 12.5, 15];
const DEFAULT_VALUE = 1;

function PillGroup({
  step,
  label,
  unit,
  options,
  value,
  onSelect,
  customValue,
  onCustomChange,
  impliedValue,
}: {
  step: number;
  label: string;
  unit: string;
  options: number[];
  value: number | null;
  onSelect: (v: number) => void;
  customValue: string;
  onCustomChange: (v: string) => void;
  impliedValue?: number;
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
        {options.map((opt) => {
          const isSelected = value === opt && customValue === '';
          const isImplied = !filled && impliedValue === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onSelect(opt)}
              className={cn(
                'px-4 py-2 rounded-full border text-sm font-medium transition-colors',
                isSelected
                  ? 'bg-primary text-white border-primary'
                  : isImplied
                  ? 'bg-surface border-2 border-dashed border-primary/50 text-text-secondary'
                  : 'bg-surface border-border hover:border-border-hover text-text-primary'
              )}
            >
              {opt}
              {unit}
            </button>
          );
        })}
      </div>
      <Input
        placeholder={`Custom ${label.toLowerCase()} (${unit})`}
        type="number"
        min="0"
        step="any"
        value={customValue}
        onChange={(e) => onCustomChange(e.target.value)}
      />
      {!filled && impliedValue !== undefined && (
        <p className="text-xs text-text-muted italic mt-2">
          Defaulting to {impliedValue}
          {unit} — click above to set your own.
        </p>
      )}
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

  const filledCount = [validStrength, validWater, validDose].filter(Boolean).length;

  // Once at least two of the three inputs are set, the third defaults to 1
  // (in its own unit) so a result is always visible rather than leaving the
  // user stuck with no feedback until all three are picked.
  const effective = useMemo(() => {
    if (filledCount < 2) return null;

    const eStrength = validStrength ? strengthMg! : DEFAULT_VALUE;
    const eWater = validWater ? waterMl! : DEFAULT_VALUE;
    const eDose = validDose ? doseMg! : DEFAULT_VALUE;

    const concentration = eStrength / eWater;
    return {
      concentration,
      vialDoses: eStrength / eDose,
      units: (eDose / eStrength) * eWater * 100,
      dose: eDose,
      // mg per single syringe unit at this concentration — lets the user work
      // out any other dose on this same vial without re-running the calculator.
      mgPerUnit: concentration / 100,
    };
  }, [filledCount, validStrength, validWater, validDose, strengthMg, waterMl, doseMg]);

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
        <PillGroup
          step={1}
          label="Vial Strength"
          unit="mg"
          options={STRENGTH_OPTIONS}
          value={strength}
          onSelect={selectStrength}
          customValue={strengthCustom}
          onCustomChange={setStrengthCustom}
          impliedValue={!validStrength && filledCount >= 2 ? DEFAULT_VALUE : undefined}
        />
        <PillGroup
          step={2}
          label="Water Added"
          unit="mL"
          options={WATER_OPTIONS}
          value={water}
          onSelect={selectWater}
          customValue={waterCustom}
          onCustomChange={setWaterCustom}
          impliedValue={!validWater && filledCount >= 2 ? DEFAULT_VALUE : undefined}
        />
        <PillGroup
          step={3}
          label="Dose"
          unit="mg"
          options={DOSE_OPTIONS}
          value={dose}
          onSelect={selectDose}
          customValue={doseCustom}
          onCustomChange={setDoseCustom}
          impliedValue={!validDose && filledCount >= 2 ? DEFAULT_VALUE : undefined}
        />
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 sm:p-8">
        <h2 className="font-display font-semibold text-xl mb-6 text-center">Results</h2>

        {!effective ? (
          <p className="text-text-secondary text-center py-8">
            Pick any two of <strong className="text-text-primary">vial strength</strong>, <strong className="text-text-primary">water added</strong>, and <strong className="text-text-primary">dose</strong> above to see your results — we&apos;ll assume 1 for whichever one you leave out.
          </p>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 w-full">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 text-center">
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Concentration</p>
                  <p className="font-display font-bold text-lg">{effective.concentration.toFixed(2)} mg/mL</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Vial Yields</p>
                  <p className="font-display font-bold text-lg">{effective.vialDoses.toFixed(1)} doses</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Dose</p>
                  <p className="font-display font-bold text-lg">{effective.dose} mg</p>
                </div>
                <div className="bg-surface-elevated rounded-lg -mx-2 -mt-2 -mb-2 px-2 pt-2 pb-2">
                  <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Draw To</p>
                  <p className="font-display font-bold text-lg">{effective.units.toFixed(2)} units</p>
                </div>
              </div>
              <SyringeGauge units={effective.units} />
              <p className="text-xs text-text-muted text-center mt-4">
                Assumes a standard U-100 insulin syringe (100 units = 1mL).
              </p>
            </div>

            <div className="w-full lg:w-64 shrink-0 bg-surface-elevated border border-border rounded-xl p-4">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
                <div className="text-sm text-text-secondary">
                  <p className="font-semibold text-text-primary mb-1">Quick reference</p>
                  <p className="mb-2">
                    <strong className="text-text-primary">{effective.dose}mg = {effective.units.toFixed(2)} units</strong> on this vial.
                  </p>
                  <p>
                    Every unit on the syringe ≈ {formatMg(effective.mgPerUnit)}mg, so you can work out other doses on the same vial without recalculating.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
