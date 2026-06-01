'use client';

import type { ApplicationRecord } from '@/lib/fileStore';

const STATUS_STYLES: Record<string, string> = {
  submitted:      'bg-green-900 text-green-300',
  skipped:        'bg-yellow-900 text-yellow-300',
  error:          'bg-red-900 text-red-300',
  already_applied: 'bg-blue-900 text-blue-300',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ApplicationsTable({ applications }: { applications: ApplicationRecord[] }) {
  // Deduplicate by job ID, keeping the latest record (last one wins since the array is append-ordered)
  const seen = new Map<string, ApplicationRecord>();
  for (const app of applications) seen.set(app.id, app);
  const unique = Array.from(seen.values());

  if (unique.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <p className="text-gray-500">No applications yet. Start the automation to see results here.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-white font-semibold text-lg">Recent Applications</h2>
        <p className="text-gray-400 text-sm">{unique.length} total</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wide">
              <th className="px-5 py-3 text-left">Job Title</th>
              <th className="px-5 py-3 text-left">Company</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Applied At</th>
              <th className="px-5 py-3 text-left">Missing Fields</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {unique.slice(0, 100).map(app => (
              <tr key={app.id} className="hover:bg-gray-800/50 transition-colors">
                <td className="px-5 py-3 text-gray-200 font-medium max-w-xs truncate">
                  <a href={app.url} target="_blank" rel="noreferrer" className="hover:text-indigo-400 transition-colors">
                    {app.title}
                  </a>
                </td>
                <td className="px-5 py-3 text-gray-300">{app.company}</td>
                <td className="px-5 py-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[app.status] ?? 'bg-gray-800 text-gray-400'}`}>
                    {app.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtDate(app.appliedAt)}</td>
                <td className="px-5 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                  {app.missingFields?.length ? app.missingFields.join(', ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
