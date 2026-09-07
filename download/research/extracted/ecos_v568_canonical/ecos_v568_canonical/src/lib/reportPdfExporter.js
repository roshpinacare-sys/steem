/**
 * reportPdfExporter.js — ECOS V142
 * ─────────────────────────────────────────────────────────────────────────────
 * [V142-PDF-01] PDF export for EU AI Act Operator Compliance Reports.
 *
 * Generates a clean, regulator-ready PDF from a structured report object
 * (produced by operatorReport.generate()).
 *
 * Strategy: pure Node.js, zero external npm packages.
 *   - Uses the existing Markdown report (_toMarkdown output) as the source.
 *   - Wraps it in a minimal HTML template.
 *   - Outputs an HTML file that can be opened in any browser and printed/saved
 *     as PDF via Ctrl+P / File > Print > Save as PDF.
 *   - Optionally: if `html-pdf-node` or `puppeteer` is available in the runtime
 *     environment, auto-detect and use for true headless PDF generation.
 *   - Designed to degrade gracefully: if no headless browser is available,
 *     returns { ok: true, format: 'html', ... } with the HTML string.
 *
 * ECOS design principle: never throw on external unavailability.
 * This module always returns something useful.
 *
 * [V142-PDF-01] Initial implementation
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

// ── CSS for the PDF/HTML output ───────────────────────────────────────────────
const PDF_CSS = `
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt; line-height: 1.55; color: #1a1a1a;
    max-width: 820px; margin: 0 auto; padding: 0;
  }
  h1 { font-size: 18pt; color: #0d1b2a; border-bottom: 2px solid #0d1b2a; padding-bottom: 6px; margin-top: 0; }
  h2 { font-size: 13pt; color: #1e3a5f; margin-top: 24px; border-bottom: 1px solid #c8d8e8; padding-bottom: 4px; }
  h3 { font-size: 11pt; color: #2c5282; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
  th { background: #1e3a5f; color: #fff; padding: 6px 10px; text-align: left; font-weight: 600; }
  td { padding: 5px 10px; border-bottom: 1px solid #dde6f0; }
  tr:nth-child(even) td { background: #f5f8fc; }
  code, pre { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 9.5pt; background: #f0f4f8; border-radius: 3px; padding: 1px 4px; }
  pre { padding: 10px 14px; display: block; overflow-x: auto; }
  .status-compliant    { color: #155724; font-weight: 700; background: #d4edda; padding: 2px 8px; border-radius: 4px; }
  .status-warn         { color: #856404; font-weight: 700; background: #fff3cd; padding: 2px 8px; border-radius: 4px; }
  .status-noncompliant { color: #721c24; font-weight: 700; background: #f8d7da; padding: 2px 8px; border-radius: 4px; }
  .badge-pass  { color: #155724; font-weight: bold; }
  .badge-warn  { color: #856404; font-weight: bold; }
  .badge-fail  { color: #721c24; font-weight: bold; }
  blockquote { border-left: 4px solid #c8d8e8; margin: 10px 0; padding: 6px 14px; color: #4a5568; }
  hr { border: none; border-top: 1px solid #c8d8e8; margin: 18px 0; }
  .disclaimer { font-size: 9pt; color: #718096; border-top: 1px solid #c8d8e8; margin-top: 32px; padding-top: 10px; }
  .header-meta { color: #4a5568; font-size: 10pt; margin-bottom: 16px; }
  @media print {
    body { font-size: 10pt; }
    h1 { font-size: 16pt; }
    h2 { font-size: 12pt; }
    .no-print { display: none; }
    a { color: inherit; text-decoration: none; }
  }
`;

// ── Markdown → HTML (minimal, no external deps) ────────────────────────────
function markdownToHtml(md) {
  if (!md || typeof md !== 'string') return '';

  let html = md
    // headings
    .replace(/^### (.+)$/gm,  '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,    '<h1>$1</h1>')
    // bold, italic, code
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code>$1</code>')
    // hr
    .replace(/^---$/gm, '<hr>')
    // blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // tables — multi-pass
    ;

  // Convert GFM tables
  html = html.replace(/(\|.+\|\n)(\|[-| :]+\|\n)((?:\|.+\|\n?)*)/g, (match, header, sep, body) => {
    const ths = header.trim().split('|').slice(1, -1).map(h => `<th>${h.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const tds = row.trim().split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Status badges
  html = html
    .replace(/`COMPLIANT_WITH_WARNINGS`/g, '<span class="status-warn">COMPLIANT_WITH_WARNINGS</span>')
    .replace(/`COMPLIANT`/g, '<span class="status-compliant">COMPLIANT</span>')
    .replace(/`NON_COMPLIANT`/g, '<span class="status-noncompliant">NON_COMPLIANT</span>')
    .replace(/\bPASS\b/g, '<span class="badge-pass">✅ PASS</span>')
    .replace(/\bWARN\b/g, '<span class="badge-warn">⚠️ WARN</span>')
    .replace(/\bFAIL\b/g, '<span class="badge-fail">❌ FAIL</span>');

  // paragraphs (lines not already in block-level elements)
  const lines = html.split('\n');
  const out = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('<table>')) { inTable = true; out.push(line); continue; }
    if (line.startsWith('</table>')) { inTable = false; out.push(line); continue; }
    if (inTable) { out.push(line); continue; }
    if (line.startsWith('<h') || line.startsWith('<hr') || line.startsWith('<blockquote') || line.startsWith('<table')) {
      out.push(line);
    } else if (line.trim() === '') {
      out.push('');
    } else {
      out.push(`<p>${line}</p>`);
    }
  }
  return out.join('\n');
}

// ── Build full HTML document ───────────────────────────────────────────────
function buildHtml(report) {
  const md = report._markdown || report;
  const mdStr = typeof md === 'string' ? md : JSON.stringify(report, null, 2);
  const bodyHtml = markdownToHtml(mdStr);
  const status = report.overallStatus || 'UNKNOWN';
  const statusClass = status === 'COMPLIANT' ? 'compliant'
    : status === 'COMPLIANT_WITH_WARNINGS' ? 'warn'
    : status === 'NON_COMPLIANT' ? 'noncompliant' : 'warn';

  const printBtn = `
    <div class="no-print" style="position:fixed;top:16px;right:16px;z-index:999;">
      <button onclick="window.print()" style="background:#1e3a5f;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
        🖨️ Save as PDF
      </button>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ECOS EU AI Act Compliance Report — ${report.identity?.ecosVersion || 'V142'}</title>
  <style>${PDF_CSS}</style>
</head>
<body>
  ${printBtn}
  <div class="header-meta">
    <strong>ECOS Compliance Report</strong> &nbsp;·&nbsp;
    Version: ${report.identity?.ecosVersion || 'V142'} &nbsp;·&nbsp;
    Generated: ${report.generatedAt || new Date().toISOString()} &nbsp;·&nbsp;
    Status: <span class="status-${statusClass}">${status}</span>
  </div>
  ${bodyHtml}
  <div class="disclaimer">
    ${report.legalDisclaimer || 'This report is machine-generated evidence. Review with qualified legal counsel before regulatory submission.'}
    &nbsp; &mdash; &nbsp; ECOS ${report.identity?.ecosVersion || 'V142'} &nbsp;·&nbsp; ${new Date().toISOString()}
  </div>
</body>
</html>`;
}

// ── Try headless PDF generation if environment supports it ────────────────
async function tryHeadlessPdf(htmlContent, outputPath) {
  // Try puppeteer (if installed)
  try {
    // eslint-disable-next-line
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' }, printBackground: true });
    await browser.close();
    if (outputPath) fs.writeFileSync(outputPath, pdfBuffer);
    return { ok: true, format: 'pdf', buffer: pdfBuffer, engine: 'puppeteer' };
  } catch (_) { /* puppeteer not available */ }

  // Try html-pdf-node (if installed)
  try {
    // eslint-disable-next-line
    const htmlPdf = require('html-pdf-node');
    const pdfBuffer = await htmlPdf.generatePdf(
      { content: htmlContent },
      { format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' } }
    );
    if (outputPath) fs.writeFileSync(outputPath, pdfBuffer);
    return { ok: true, format: 'pdf', buffer: pdfBuffer, engine: 'html-pdf-node' };
  } catch (_) { /* html-pdf-node not available */ }

  return null; // No headless engine available
}

// ── Main export API ────────────────────────────────────────────────────────
class ReportPdfExporter {
  constructor() {
    this._outputDir = process.env.ECOS_REPORT_OUTPUT_DIR || '/tmp';
  }

  /**
   * Export a compliance report as PDF (or HTML fallback).
   *
   * @param {object} opts
   * @param {object}  opts.report          — report object from operatorReport.generate()
   * @param {string}  [opts.outputPath]    — optional: write file to disk at this path
   * @param {boolean} [opts.preferHtml]    — if true, skip headless attempt, return HTML directly
   * @returns {Promise<ExportResult>}
   */
  async export({ report, outputPath, preferHtml = false } = {}) {
    if (!report) throw new Error('[ReportPdfExporter] report is required');

    const htmlContent = buildHtml(report);

    // Callers that just want HTML (e.g., /operator-report?format=html endpoint)
    if (preferHtml) {
      if (outputPath) fs.writeFileSync(outputPath.replace(/\.pdf$/i, '.html'), htmlContent);
      return {
        ok: true,
        format: 'html',
        html: htmlContent,
        engine: 'built-in',
        size: Buffer.byteLength(htmlContent, 'utf8'),
        generatedAt: new Date().toISOString(),
      };
    }

    // Try headless PDF
    if (!preferHtml) {
      const pdfPath = outputPath || path.join(this._outputDir, `ecos-report-${Date.now()}.pdf`);
      const pdfResult = await tryHeadlessPdf(htmlContent, pdfPath);
      if (pdfResult) {
        return {
          ...pdfResult,
          size: pdfResult.buffer ? pdfResult.buffer.length : null,
          outputPath: pdfPath,
          generatedAt: new Date().toISOString(),
        };
      }
    }

    // Graceful fallback: return HTML
    const htmlPath = outputPath ? outputPath.replace(/\.pdf$/i, '.html') : null;
    if (htmlPath) fs.writeFileSync(htmlPath, htmlContent);

    return {
      ok: true,
      format: 'html',
      html: htmlContent,
      engine: 'built-in-fallback',
      note: 'No headless PDF engine detected. Install puppeteer for true PDF output. HTML is print-ready (Ctrl+P → Save as PDF).',
      size: Buffer.byteLength(htmlContent, 'utf8'),
      outputPath: htmlPath,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Return content-type and filename for HTTP response.
   */
  static httpHeaders(format) {
    if (format === 'pdf') return {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ecos-compliance-report-${Date.now()}.pdf"`,
    };
    return {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="ecos-compliance-report-${Date.now()}.html"`,
    };
  }
}

let _instance = null;
function getReportPdfExporter() {
  if (!_instance) _instance = new ReportPdfExporter();
  return _instance;
}

module.exports = { ReportPdfExporter, getReportPdfExporter, buildHtml, markdownToHtml };
