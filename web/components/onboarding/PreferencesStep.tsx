'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserPrefs } from '@/lib/fileStore';

interface PreferencesStepProps {
  onBack: () => void;
}

function TagInput({ label, values, onChange, placeholder }: {
  label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [input, setInput] = useState('');
  function add() {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput('');
  }
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2 min-h-[2rem]">
        {values.map(v => (
          <span key={v} className="flex items-center gap-1 bg-indigo-900 text-indigo-200 px-3 py-1 rounded-full text-sm">
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="text-indigo-400 hover:text-white ml-1">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder ?? 'Type and press Enter'}
          className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button type="button" onClick={add} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm">Add</button>
      </div>
    </div>
  );
}

const DEFAULT_PREFS: UserPrefs = {
  keywords: 'fresher software developer',
  location: 'Bengaluru',
  workMode: ['remote', 'hybrid', 'onsite'],
  minExperience: 0,
  maxExperience: 1,
  maxApplications: 25,
  easyApplyOnly: true,
  requiresSponsorship: false,
  minSalary: 500000,
  maxSalary: 1500000,
  jobTitles: ['Software Engineer', 'Frontend Developer', 'Full Stack Developer'],
  experienceLevel: 'fresher',
};

export default function PreferencesStep({ onBack }: PreferencesStepProps) {
  const router = useRouter();
  const [p, setP] = useState<UserPrefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set<K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) {
    setP(prev => ({ ...prev, [key]: value }));
  }

  function toggleWorkMode(mode: string) {
    set('workMode', p.workMode.includes(mode)
      ? p.workMode.filter(m => m !== mode)
      : [...p.workMode, mode]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    // Build keywords from first job title for Playwright CONFIG
    const prefsToSave = { ...p, keywords: p.jobTitles[0] ?? p.keywords };
    try {
      const res = await fetch('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefsToSave) });
      if (!res.ok) throw new Error('Failed to save preferences');
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const workModes = ['remote', 'hybrid', 'onsite'] as const;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Job Preferences</h2>
        <p className="mt-1 text-gray-400">Tell us what kinds of jobs to apply for.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <TagInput
          label="Job Titles (the automation searches for the first one)"
          values={p.jobTitles}
          onChange={v => set('jobTitles', v)}
          placeholder="e.g. Software Engineer"
        />

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Primary Location</label>
          <input
            value={p.location}
            onChange={e => set('location', e.target.value)}
            placeholder="e.g. Bengaluru"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Work Mode</label>
          <div className="flex gap-3">
            {workModes.map(m => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={p.workMode.includes(m)} onChange={() => toggleWorkMode(m)} className="w-4 h-4 accent-indigo-500" />
                <span className="text-gray-300 text-sm capitalize">{m}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Experience Level</label>
          <div className="flex gap-4 mb-3">
            {(['fresher', 'experienced'] as const).map(level => (
              <label key={level} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="experienceLevel"
                  value={level}
                  checked={p.experienceLevel === level}
                  onChange={() => {
                    set('experienceLevel', level);
                    if (level === 'fresher') { set('minExperience', 0); set('maxExperience', 1); }
                  }}
                  className="w-4 h-4 accent-indigo-500"
                />
                <span className="text-gray-300 text-sm capitalize">{level}</span>
              </label>
            ))}
          </div>
          {p.experienceLevel === 'experienced' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Min Years</label>
                <input type="number" min={1} max={20} value={p.minExperience}
                  onChange={e => set('minExperience', +e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Max Years</label>
                <input type="number" min={1} max={20} value={p.maxExperience}
                  onChange={e => set('maxExperience', +e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Min Salary (₹)</label>
            <input type="number" min={0} value={p.minSalary} onChange={e => set('minSalary', +e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Max Salary (₹)</label>
            <input type="number" min={0} value={p.maxSalary} onChange={e => set('maxSalary', +e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Max Applications</label>
          <input type="number" min={1} max={200} value={p.maxApplications} onChange={e => set('maxApplications', +e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500" />
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={p.easyApplyOnly} onChange={e => set('easyApplyOnly', e.target.checked)} className="w-4 h-4 accent-indigo-500" />
            <span className="text-gray-300 text-sm">Easy Apply only</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={p.requiresSponsorship} onChange={e => set('requiresSponsorship', e.target.checked)} className="w-4 h-4 accent-indigo-500" />
            <span className="text-gray-300 text-sm">Requires visa sponsorship</span>
          </label>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold rounded-xl transition-colors">← Back</button>
          <button type="submit" disabled={saving} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors">
            {saving ? 'Saving...' : 'Save & Go to Dashboard →'}
          </button>
        </div>
      </form>
    </div>
  );
}
