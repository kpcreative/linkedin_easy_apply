'use client';

import { useState } from 'react';
import type { UserProfile } from '@/lib/fileStore';

interface ProfileStepProps {
  profile: Partial<UserProfile>;
  onNext: (profile: Partial<UserProfile>) => void;
  onBack: () => void;
}

function TagInput({
  label, values, onChange,
}: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  function add() {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput('');
  }
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {values.map(v => (
          <span key={v} className="flex items-center gap-1 bg-indigo-900 text-indigo-200 px-3 py-1 rounded-full text-sm">
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} className="text-indigo-400 hover:text-white ml-1">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Type and press Enter"
          className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button type="button" onClick={add} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm">Add</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
      />
    </div>
  );
}

export default function ProfileStep({ profile, onNext, onBack }: ProfileStepProps) {
  const [p, setP] = useState<Partial<UserProfile>>(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setP(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
      if (!res.ok) throw new Error('Failed to save profile');
      onNext(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Review Your Profile</h2>
        <p className="mt-1 text-gray-400">AI extracted this from your resume. Edit anything that looks wrong.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="First Name" value={p.firstName ?? ''} onChange={v => set('firstName', v)} />
          <Field label="Last Name" value={p.lastName ?? ''} onChange={v => set('lastName', v)} />
        </div>
        <Field label="Email" value={p.email ?? ''} onChange={v => set('email', v)} type="email" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone" value={p.phone ?? ''} onChange={v => set('phone', v)} />
          <Field label="City" value={p.city ?? ''} onChange={v => set('city', v)} />
        </div>
        <Field label="LinkedIn URL" value={p.linkedinUrl ?? ''} onChange={v => set('linkedinUrl', v)} />
        <Field label="GitHub URL" value={p.githubUrl ?? ''} onChange={v => set('githubUrl', v)} />

        <TagInput
          label="Skills"
          values={p.skills ?? []}
          onChange={v => set('skills', v)}
        />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Years of Experience</label>
            <input
              type="number" min={0} max={30}
              value={p.yearsOfTotalExperience ?? 0}
              onChange={e => set('yearsOfTotalExperience', parseInt(e.target.value, 10))}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Education</label>
            <input
              type="text"
              value={p.education?.[0]?.degree ?? ''}
              onChange={e => set('education', [{ degree: e.target.value, institution: p.education?.[0]?.institution ?? '', year: p.education?.[0]?.year ?? 0 }])}
              placeholder="e.g. B.Tech Computer Science"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Current CTC (₹)</label>
            <input
              type="number" min={0}
              value={p.currentCTC ?? '1000000'}
              onChange={e => set('currentCTC', e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Expected / Desired Salary (₹)</label>
            <input
              type="number" min={0}
              value={p.desiredSalary ?? '1800000'}
              onChange={e => set('desiredSalary', e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={p.relocation ?? true} onChange={e => set('relocation', e.target.checked)} className="w-4 h-4 accent-indigo-500" />
            <span className="text-gray-300 text-sm">Open to relocation</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={p.requiresSponsorship ?? false} onChange={e => set('requiresSponsorship', e.target.checked)} className="w-4 h-4 accent-indigo-500" />
            <span className="text-gray-300 text-sm">Requires visa sponsorship</span>
          </label>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold rounded-xl transition-colors">← Back</button>
          <button type="submit" disabled={saving} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors">
            {saving ? 'Saving...' : 'Save & Continue →'}
          </button>
        </div>
      </form>
    </div>
  );
}
