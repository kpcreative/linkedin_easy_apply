import { NextRequest, NextResponse } from 'next/server';
import { readPrefs, writePrefs } from '@/lib/fileStore';

export async function GET() {
  return NextResponse.json(readPrefs());
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    writePrefs(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
