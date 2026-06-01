import Link from "next/link";
import StatsCards from "@/components/dashboard/StatsCards";
import AutomationPanel from "@/components/dashboard/AutomationPanel";
import ApplicationsTable from "@/components/dashboard/ApplicationsTable";
import { readApplications } from "@/lib/fileStore";

export const revalidate = 0; // always serve fresh data

function buildStats(applications: ReturnType<typeof readApplications>) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const submitted = applications.filter((a) => a.status === "submitted");
  return {
    total: applications.length,
    submitted: submitted.length,
    skipped: applications.filter((a) => a.status === "skipped").length,
    errors: applications.filter((a) => a.status === "error").length,
    alreadyApplied: applications.filter((a) => a.status === "already_applied").length,
    appliedToday: submitted.filter(
      (a) => a.appliedAt && new Date(a.appliedAt) >= todayStart
    ).length,
    appliedThisWeek: submitted.filter(
      (a) => a.appliedAt && new Date(a.appliedAt) >= weekStart
    ).length,
    companies: [...new Set(submitted.map((a) => a.company))].length,
    successRate:
      applications.length > 0
        ? Math.round((submitted.length / applications.length) * 100)
        : 0,
  };
}

export default function DashboardPage() {
  const applications = readApplications();
  const stats = buildStats(applications);

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Navbar */}
      <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-white font-semibold text-lg">AI Job Agent</span>
          <Link
            href="/onboarding"
            className="px-4 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors"
          >
            Edit Profile &amp; Preferences
          </Link>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Monitor your AI-powered job application agent
          </p>
        </div>

        <StatsCards stats={stats} />
        <AutomationPanel />
        <ApplicationsTable applications={[...applications].reverse()} />
      </main>
    </div>
  );
}
