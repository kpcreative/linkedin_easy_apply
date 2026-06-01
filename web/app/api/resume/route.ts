import { NextRequest, NextResponse } from 'next/server';
import { parseResume } from '@/lib/resumeParser';
import { extractProfile } from '@/lib/llm';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const text = formData.get('text') as string | null;

    let resumeText = '';

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      resumeText = await parseResume(buffer, file.name);
    } else if (text) {
      resumeText = text.trim();
    } else {
      return NextResponse.json({ error: 'No file or text provided' }, { status: 400 });
    }

    if (!resumeText) {
      return NextResponse.json({ error: 'Could not extract text from resume' }, { status: 422 });
    }

    const profile = await extractProfile(resumeText);
    return NextResponse.json({ profile, resumeText: resumeText.slice(0, 200) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
