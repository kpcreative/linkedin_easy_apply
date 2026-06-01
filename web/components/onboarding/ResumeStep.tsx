'use client';

import { useState, useRef } from 'react';
import type { UserProfile } from '@/lib/fileStore';

interface ResumeStepProps {
  onNext: (profile: Partial<UserProfile>) => void;
}

export default function ResumeStep({ onNext }: ResumeStepProps) {
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const formData = new FormData();
      if (mode === 'upload' && fileRef.current?.files?.[0]) {
        formData.append('file', fileRef.current.files[0]);
      } else if (mode === 'paste' && pastedText.trim()) {
        formData.append('text', pastedText.trim());
      } else {
        setError('Please upload a file or paste your resume text.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/resume', { method: 'POST', body: formData });
      const data = await res.json() as { profile?: Partial<UserProfile>; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Extraction failed');
      onNext(data.profile ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Upload Your Resume</h2>
        <p className="mt-1 text-gray-400">We&apos;ll extract your profile automatically using AI.</p>
      </div>

      <div className="flex gap-2">
        {(['upload', 'paste'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {m === 'upload' ? 'Upload File' : 'Paste Text'}
          </button>
        ))}
      </div>

      <form onSubmit={handleExtract} className="space-y-4">
        {mode === 'upload' ? (
          <div
            className="border-2 border-dashed border-gray-600 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-500 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" />
            <p className="text-4xl mb-2">📄</p>
            <p className="text-gray-300 font-medium">Click to upload PDF, DOCX, or TXT</p>
            <p className="text-gray-500 text-sm mt-1">PDF, DOCX, or plain text</p>
          </div>
        ) : (
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder="Paste your resume text here..."
            rows={12}
            className="w-full bg-gray-800 border border-gray-600 rounded-xl p-4 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none font-mono text-sm"
          />
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
        >
          {loading ? 'Extracting with AI...' : 'Extract Profile →'}
        </button>
      </form>
    </div>
  );
}
