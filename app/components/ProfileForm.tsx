'use client';

import { useState } from 'react';
import { UserProfile } from '@/app/types';
import { DISCIPLINES, COUNTRIES } from '@/app/lib/mockData';
import { ChevronRight, ChevronLeft, Check, User, BookOpen, Target } from 'lucide-react';
import AppLogo from './AppLogo';

interface ProfileFormProps {
  onComplete: (profile: UserProfile) => void;
}

const TOTAL_STEPS = 3;

export default function ProfileForm({ onComplete }: ProfileFormProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [cgpa, setCgpa] = useState('');
  const [targetDegree, setTargetDegree] = useState<'BSc' | 'MSc' | 'PhD'>('MSc');
  const [countryPreference, setCountryPreference] = useState<string[]>([]);
  const [careerGoal, setCareerGoal] = useState('');
  const [error, setError] = useState<string | null>(null);

  function toggleCountry(country: string) {
    setCountryPreference((prev) =>
      prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country]
    );
  }

  function validateCurrentStep(): boolean {
    setError(null);
    if (step === 1) {
      if (!name.trim()) return setError('Please enter your name'), false;
      if (!discipline) return setError('Please select a discipline'), false;
    }
    if (step === 2) {
      const n = parseFloat(cgpa);
      if (Number.isNaN(n) || n < 0 || n > 5)
        return setError('Please enter a valid CGPA between 0 and 5'), false;
      if (!targetDegree) return setError('Please select a target degree'), false;
    }
    if (step === 3) {
      if (countryPreference.length === 0)
        return setError('Select at least one country preference'), false;
      if (!careerGoal.trim()) return setError('Please share your career goal'), false;
    }
    return true;
  }

  function handleNext() {
    if (validateCurrentStep()) setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  function handleBack() {
    setStep((s) => Math.max(1, s - 1));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateCurrentStep()) return;
    const profile: UserProfile = {
      id: `user-${Date.now()}`,
      name: name.trim(),
      discipline,
      cgpa: parseFloat(cgpa),
      targetDegree,
      countryPreference,
      careerGoal: careerGoal.trim(),
    };
    onComplete(profile);
  }

  const stepMeta = [
    { icon: User, label: 'About you' },
    { icon: BookOpen, label: 'Academics' },
    { icon: Target, label: 'Goals' },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8 page-bg relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-30 pointer-events-none" style={{ backgroundColor: 'var(--primary)' }} />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ backgroundColor: 'var(--primary-light)' }} />

      <div className="relative flex items-center gap-3 font-bold text-2xl mb-6" style={{ color: 'var(--primary)' }}>
        <AppLogo size={64} />
        ScholarPilot AI
      </div>

      <div className="relative w-full max-w-md card-elevated p-5 sm:p-8">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            {stepMeta.map((s, idx) => {
              const Icon = s.icon;
              const isActive = step === idx + 1;
              const isCompleted = step > idx + 1;
              return (
                <div key={idx} className="flex flex-col items-center gap-2">
                  <div
                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all ${
                      isActive
                        ? 'gradient-emerald text-white shadow-md shadow-emerald-200'
                        : isCompleted
                        ? 'text-[var(--primary)]'
                        : 'text-tertiary'
                    }`}
                    style={{ backgroundColor: isCompleted ? 'var(--primary-fade)' : isActive ? undefined : 'var(--surface-muted)' }}
                  >
                    {isCompleted ? <Check className="w-4 h-4 sm:w-5 sm:h-5" /> : <Icon className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </div>
                  <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wide ${isActive ? 'text-[var(--primary)]' : 'text-tertiary'}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="h-1.5 rounded-full overflow-hidden surface-muted">
            <div className="h-full gradient-emerald transition-all duration-500" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
          </div>
        </div>

        <h1 className="text-xl sm:text-2xl font-extrabold text-primary mb-2">
          Build your scholarship profile
        </h1>
        <p className="text-sm text-secondary mb-5">
          A few details help ScholarPilot match you with the best funding opportunities.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm font-bold border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="block text-sm font-bold text-secondary mb-1.5">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ada Obi"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-secondary mb-1.5">Discipline</label>
                <select
                  value={discipline}
                  onChange={(e) => setDiscipline(e.target.value)}
                  className="input"
                >
                  <option value="">Select your field</option>
                  {DISCIPLINES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="block text-sm font-bold text-secondary mb-1.5">CGPA</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={5}
                  value={cgpa}
                  onChange={(e) => setCgpa(e.target.value)}
                  placeholder="e.g. 4.35"
                  className="input"
                />
                <p className="text-xs text-tertiary mt-1.5">Enter on a scale of 0–5</p>
              </div>
              <div>
                <label className="block text-sm font-bold text-secondary mb-2">Target degree</label>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {(['BSc', 'MSc', 'PhD'] as const).map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => setTargetDegree(deg)}
                      className={`px-2 sm:px-3 py-3 rounded-xl text-sm font-bold border transition-all ${
                        targetDegree === deg
                          ? 'text-white border-transparent shadow-md shadow-emerald-200'
                          : 'text-secondary border-[var(--border)] hover:border-[var(--primary)]'
                      }`}
                      style={{ backgroundColor: targetDegree === deg ? 'var(--primary)' : undefined }}
                    >
                      {deg}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="block text-sm font-bold text-secondary mb-2">
                  Preferred study destinations
                </label>
                <div className="flex flex-wrap gap-2">
                  {COUNTRIES.map((country) => {
                    const selected = countryPreference.includes(country);
                    return (
                      <button
                        key={country}
                        type="button"
                        onClick={() => toggleCountry(country)}
                        className={`px-3 sm:px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                          selected
                            ? 'text-white border-transparent shadow-sm shadow-emerald-200'
                            : 'text-secondary border-[var(--border)] hover:border-[var(--primary)]'
                        }`}
                        style={{ backgroundColor: selected ? 'var(--primary)' : undefined }}
                      >
                        {country}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-secondary mb-1.5">
                  Career goal
                </label>
                <textarea
                  value={careerGoal}
                  onChange={(e) => setCareerGoal(e.target.value)}
                  placeholder="What do you want to achieve after your degree?"
                  rows={4}
                  className="input resize-none"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1}
              className={`flex items-center gap-1 text-sm font-bold px-4 py-2.5 rounded-xl transition-colors ${
                step === 1
                  ? 'text-tertiary cursor-not-allowed'
                  : 'text-secondary hover:bg-[var(--surface-muted)]'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            {step < TOTAL_STEPS ? (
              <button type="button" onClick={handleNext} className="btn-primary">
                Next step
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="submit" className="btn-primary">
                <Check className="w-4 h-4" />
                Save profile
              </button>
            )}
          </div>
        </form>
      </div>

      <p className="relative mt-5 text-xs text-tertiary">
        Your information is stored locally on your device.
      </p>
    </div>
  );
}
