import { NextRequest, NextResponse } from 'next/server';
import { readProfile, writeProfile } from '@/lib/fileStore';

export async function GET() {
  return NextResponse.json(readProfile());
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    // Merge with existing profile so fields not extracted from resume (salary, gender, etc.) are preserved
    const existing = readProfile();
    writeProfile({ ...existing, ...body });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
