'use client';

interface Stats {
  total: number;
  submitted: number;
  skipped: number;
  errors: number;
  appliedToday: number;
  appliedThisWeek: number;
  companies: number;
  successRate: number;
}

export default function StatsCards({ stats }: { stats: Stats }) {
  const cards = [
    { label: 'Total Processed', value: stats.total, color: 'text-gray-200' },
    { label: 'Applied', value: stats.submitted, color: 'text-green-400' },
    { label: 'Applied Today', value: stats.appliedToday, color: 'text-indigo-400' },
    { label: 'This Week', value: stats.appliedThisWeek, color: 'text-blue-400' },
    { label: 'Companies', value: stats.companies, color: 'text-purple-400' },
    { label: 'Success Rate', value: `${stats.successRate}%`, color: 'text-yellow-400' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
          <div className={`text-3xl font-bold ${c.color}`}>{c.value}</div>
          <div className="text-gray-400 text-xs mt-1">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
