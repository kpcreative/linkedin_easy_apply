import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  readAutomationPid,
  writeAutomationPid,
  clearAutomationPid,
  readAutomationLog,
} from '@/lib/fileStore';

// POST /api/automation  — start automation
export async function POST(_req: NextRequest) {
  const existingPid = readAutomationPid();
  if (existingPid) {
    try {
      process.kill(existingPid, 0); // check if still alive
      return NextResponse.json({ error: 'Automation already running', pid: existingPid }, { status: 409 });
    } catch {
      clearAutomationPid(); // stale PID — clear it
    }
  }

  const projectRoot = path.join(process.cwd(), '..');
  const logPath = path.join(projectRoot, 'data', 'automation.log');

  // Clear old log
  try { fs.writeFileSync(logPath, '', 'utf-8'); } catch { /* ignore */ }

  const child = spawn('npx', ['ts-node', 'scripts/linkedin-easy-apply.ts'], {
    cwd: projectRoot,
    env: { ...process.env },
    detached: false,
    shell: true,
  });

  writeAutomationPid(child.pid!);

  // Stream stdout + stderr to log file
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  child.on('exit', () => {
    clearAutomationPid();
    logStream.end();
  });

  return NextResponse.json({ ok: true, pid: child.pid });
}

// DELETE /api/automation  — stop automation
export async function DELETE() {
  const pid = readAutomationPid();
  if (!pid) return NextResponse.json({ error: 'No automation running' }, { status: 404 });

  try {
    if (process.platform === 'win32') {
      // On Windows, SIGTERM only kills cmd.exe; taskkill /T kills the full process tree
      const { execSync } = await import('child_process');
      try { execSync(`taskkill /PID ${pid} /T /F`); } catch { /* already dead */ }
    } else {
      process.kill(pid, 'SIGTERM');
    }
    clearAutomationPid();
    return NextResponse.json({ ok: true });
  } catch (err) {
    clearAutomationPid();
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/automation  — status + recent log lines
export async function GET() {
  const pid = readAutomationPid();
  let running = false;

  if (pid) {
    try { process.kill(pid, 0); running = true; }
    catch { clearAutomationPid(); }
  }

  const recentLines = readAutomationLog(60);
  return NextResponse.json({ running, pid: running ? pid : null, recentLines });
}
