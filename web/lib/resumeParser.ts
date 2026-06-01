// Resume parsing: PDF and DOCX → plain text

export async function parseResume(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf') {
    // pdf-parse v2 uses a class-based API — PDFParse({ data }) then .getText()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse') as {
      PDFParse: new (opts: { data: Uint8Array }) => {
        getText(params?: Record<string, unknown>): Promise<{ text: string }>;
        destroy(): Promise<void>;
      };
    };
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  if (ext === 'docx' || ext === 'doc') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  // Plain text fallback
  return buffer.toString('utf-8').trim();
}
