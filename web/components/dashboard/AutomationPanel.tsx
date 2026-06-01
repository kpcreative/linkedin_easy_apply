'use client';

import { useState, useEffect, useRef } from 'react';

interface AutomationState {
  running: boolean;
  pid: number | null;
  recentLines: string[];
}

export default function AutomationPanel() {
  const [state, setState] = useState<AutomationState>({ running: false, pid: null, recentLines: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/automation');
      const data = await res.json() as AutomationState;
      setState(data);
    } catch {
      setState(prev => ({ ...prev })); // keep last known state; don't crash UI
    }
  }

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.recentLines]);

  async function startAutomation() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/automation', { method: 'POST' });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to start');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function stopAutomation() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/automation', { method: 'DELETE' });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to stop');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-white font-semibold text-lg">Automation</h2>
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            state.running ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${state.running ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
            {state.running ? `Running (PID ${state.pid})` : 'Stopped'}
          </span>
        </div>

        <div className="flex gap-2">
          {!state.running ? (
            <button
              onClick={startAutomation}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? 'Starting...' : '▶ Start Automation'}
            </button>
          ) : (
            <button
              onClick={stopAutomation}
              disabled={loading}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? 'Stopping...' : '■ Stop'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Log console */}
      <div
        ref={logRef}
        className="bg-black rounded-lg p-4 h-48 overflow-y-auto font-mono text-xs text-green-300 leading-relaxed"
      >
        {state.recentLines.length === 0 ? (
          <span className="text-gray-600">No logs yet. Start the automation to see activity.</span>
        ) : (
          state.recentLines.map((line, i) => (
            <div key={i} className={
              line.includes('[AI]') ? 'text-cyan-300' :
              line.includes('ERROR') || line.includes('error') ? 'text-red-400' :
              line.includes('✓') || line.includes('submitted') ? 'text-green-300' :
              'text-gray-400'
            }>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
