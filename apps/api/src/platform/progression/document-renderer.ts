import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';

/**
 * Rendering issued award documents (Phase 3 D-20). A document is rendered
 * only from the issue's frozen content snapshot, never from live data, so the
 * PDF states exactly what was issued. The reference renderer is pdfmake (MIT,
 * pure JavaScript, no browser binary) with the PDF standard fonts.
 *
 * Templates are versioned layouts per document type. The built-in templates
 * here are deliberately neutral (no crest, signatory or institutional
 * wording); an institution supplies its own.
 */
export interface RenderInput {
  documentTypeCode: string;
  snapshot: Record<string, unknown>;
  issueNumber: number;
  issueTypeCode: string;
  verificationCode: string;
  issuedAt: Date;
  institutionName: string;
  verificationUrl: string;
}

export interface RenderedDocument { pdf: Buffer; templateCode: string; templateVersion: string }

export interface DocumentRenderer {
  render(input: RenderInput): Promise<RenderedDocument>;
}

export const BUILT_IN_TEMPLATE_VERSION = 'builtin-1';

const FONTS = { Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } };
const TITLES: Record<string, string> = {
  certificate: 'Award Certificate', transcript: 'Academic Transcript', hear: 'Higher Education Achievement Report', 'award-letter': 'Award Letter',
};
const ISSUE_NOTES: Record<string, string> = { replacement: 'Replacement issue', 'corrected-name': 'Corrected-name issue', 'certified-copy': 'Certified copy' };

interface ModuleResult { moduleCode: string; moduleTitle: string; creditValue: number; academicYear: string; aggregateMark: number; resultCode: string }

export class PdfmakeRenderer implements DocumentRenderer {
  readonly #printer = new PdfPrinter(FONTS);

  render(input: RenderInput): Promise<RenderedDocument> {
    const s = input.snapshot;
    const str = (k: string) => (typeof s[k] === 'string' ? s[k] : '');
    const title = TITLES[input.documentTypeCode] ?? 'Award Document';
    const body: Content[] = [
      { text: input.institutionName, style: 'institution' },
      { text: title, style: 'title' },
      ...(ISSUE_NOTES[input.issueTypeCode] ? [{ text: `${ISSUE_NOTES[input.issueTypeCode]} (issue ${input.issueNumber})`, style: 'note' } as Content] : []),
      { text: 'This is to certify that', margin: [0, 24, 0, 4] },
      { text: str('holderName'), style: 'holder' },
      { text: `student number ${str('studentNumber')}`, style: 'note' },
      { text: 'was awarded', margin: [0, 16, 0, 4] },
      { text: str('qualificationCode'), style: 'award' },
      { text: `Classification: ${str('classificationCode')}`, margin: [0, 4, 0, 0] },
      { text: `Date of award: ${str('awardDate')}`, margin: [0, 2, 0, 0] },
    ];
    const results = Array.isArray(s['moduleResults']) ? s['moduleResults'] as ModuleResult[] : [];
    if ((input.documentTypeCode === 'transcript' || input.documentTypeCode === 'hear') && results.length > 0) {
      body.push({ text: 'Modules', style: 'section' });
      body.push({
        table: {
          headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
          body: [
            ['Code', 'Module', 'Credits', 'Year', 'Mark', 'Result'].map((h) => ({ text: h, bold: true })),
            ...results.map((r) => [r.moduleCode, r.moduleTitle, String(r.creditValue), r.academicYear, String(r.aggregateMark), r.resultCode]),
          ],
        },
        layout: 'lightHorizontalLines', fontSize: 9,
      });
    }
    const definition: TDocumentDefinitions = {
      info: { title: `${title}: ${str('holderName')}`, creationDate: input.issuedAt, producer: 'Revelation SRS', creator: 'Revelation SRS' },
      pageSize: 'A4', pageMargins: [56, 56, 56, 72],
      defaultStyle: { font: 'Helvetica', fontSize: 11 },
      content: body,
      footer: () => ({
        margin: [56, 0, 56, 24], fontSize: 8, color: '#444444',
        text: `Issued ${input.issuedAt.toISOString().slice(0, 10)} · Verification code ${input.verificationCode} · Check this document at ${input.verificationUrl}`,
      }),
      styles: {
        institution: { fontSize: 14, bold: true, alignment: 'center' },
        title: { fontSize: 22, bold: true, alignment: 'center', margin: [0, 12, 0, 0] },
        holder: { fontSize: 20, bold: true },
        award: { fontSize: 16, bold: true },
        note: { fontSize: 9, color: '#444444' },
        section: { fontSize: 13, bold: true, margin: [0, 20, 0, 6] },
      },
    };
    return new Promise((resolve, reject) => {
      const doc = this.#printer.createPdfKitDocument(definition);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), templateCode: input.documentTypeCode, templateVersion: BUILT_IN_TEMPLATE_VERSION }));
      doc.on('error', reject);
      doc.end();
    });
  }
}
