import { NextRequest, NextResponse } from 'next/server';
import { readApplications } from '@/lib/fileStore';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') ?? '200', 10);

  const all = readApplications();
  const filtered = statusFilter ? all.filter(a => a.status === statusFilter) : all;
  const applications = filtered.slice(-limit).reverse();

  // Build stats
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart  = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const submitted = all.filter(a => a.status === 'submitted');
  const appliedToday    = submitted.filter(a => a.appliedAt && new Date(a.appliedAt) >= todayStart).length;
  const appliedThisWeek = submitted.filter(a => a.appliedAt && new Date(a.appliedAt) >= weekStart).length;

  const companies = [...new Set(submitted.map(a => a.company))];

  return NextResponse.json({
    applications,
    stats: {
      total:           all.length,
      submitted:       submitted.length,
      skipped:         all.filter(a => a.status === 'skipped').length,
      errors:          all.filter(a => a.status === 'error').length,
      alreadyApplied:  all.filter(a => a.status === 'already_applied').length,
      appliedToday,
      appliedThisWeek,
      companies:       companies.length,
      successRate:     all.length > 0 ? Math.round((submitted.length / all.length) * 100) : 0,
    },
  });
}
