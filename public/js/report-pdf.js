// Builds the PDF report from the shared report model (see reportModel in core.js).
// jsPDF and jspdf-autotable must be loaded first. In the browser they are on window.jspdf.

const ACCENT = [47, 107, 220]; // AlgoWorld's accent, so the report matches the site
const INK = [31, 30, 29];
const TEXT2 = [74, 73, 68];
const MUTED = [107, 106, 100];
const LINE = [226, 223, 213];
const WHITE = [255, 255, 255];
const ROW_ALT = [249, 248, 244];

const TONES = {
  danger: { fg: [178, 58, 50], bg: [251, 238, 236] },
  warn: { fg: [138, 91, 16], bg: [252, 244, 228] },
  ok: { fg: [42, 112, 67], bg: [236, 245, 239] },
  muted: { fg: MUTED, bg: [245, 243, 236] },
};

const MARGIN = 44;
const DESCRIPTION_LIMIT = 900;

// jsPDF's built-in fonts only cover Latin-1. Typographic characters are mapped to ASCII, and anything else becomes "?".
export function pdfText(value) {
  return String(value ?? '')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•●]/g, '-')
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, '?');
}

function limit(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function buildReportPdf(model, jsPDF) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({
    title: pdfText(`Josked breach report - ${model.email}`),
    subject: 'Data breach report',
    author: 'Josked',
    creator: 'Josked',
  });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - MARGIN * 2;
  const BOTTOM = H - 70; // above the footer
  let y = 0;

  const fill = (c) => doc.setFillColor(...c);
  const draw = (c) => doc.setDrawColor(...c);
  const ink = (c) => doc.setTextColor(...c);
  const font = (style, size, color = INK, family = 'helvetica') => {
    doc.setFont(family, style);
    doc.setFontSize(size);
    ink(color);
  };
  const write = (value, x, at, opts) => doc.text(pdfText(value), x, at, opts);
  const wrap = (value, width) => doc.splitTextToSize(pdfText(value), width);
  const need = (h) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      chrome();
      y = MARGIN + 18;
    }
  };
  // Every page gets the accent bar, including pages that autoTable adds.
  const chrome = () => {
    fill(ACCENT);
    doc.rect(0, 0, W, 5, 'F');
  };

  const section = (title) => {
    need(44);
    font('bold', 12.5, INK, 'times');
    write(title, MARGIN, y);
    draw(LINE);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y + 8, W - MARGIN, y + 8);
    y += 24;
  };

  chrome();
  y = MARGIN;

  // Masthead
  font('bold', 10, ACCENT);
  write('JOSKED', MARGIN, y + 8, { charSpace: 1.5 });
  font('normal', 8, MUTED);
  write('BREACH REPORT', W - MARGIN, y + 8, { align: 'right', charSpace: 1 });
  draw(LINE);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y + 20, W - MARGIN, y + 20);
  y += 50;

  // Title and the email being checked
  font('normal', 30, INK, 'times');
  write('Breach report', MARGIN, y + 22);
  font('normal', 11, TEXT2);
  write(`Exposure check for ${model.email}`, MARGIN, y + 42);
  y += 64;

  // Meta row
  const metaCols = [
    { label: 'Email', value: model.email, w: CW * 0.4 },
    { label: 'Checked', value: model.checkedAt || '—', w: CW * 0.2 },
    { label: 'Report date', value: model.generatedAt, w: CW * 0.2 },
    { label: 'Source', value: 'XposedOrNot', w: CW * 0.2 },
  ];
  let x = MARGIN;
  let metaHeight = 0;
  for (const col of metaCols) {
    font('bold', 7, MUTED);
    write(col.label.toUpperCase(), x, y, { charSpace: 0.8 });
    font('normal', 10, INK);
    const lines = wrap(col.value, col.w - 14);
    lines.forEach((ln, i) => write(ln, x, y + 15 + i * 13));
    metaHeight = Math.max(metaHeight, 15 + lines.length * 13);
    x += col.w;
  }
  y += metaHeight + 18;

  // Verdict
  const tone = TONES[model.verdict.tone] ?? TONES.muted;
  const verdictLines = wrap(model.verdict.text, CW - 44);
  const vh = 40 + verdictLines.length * 13.5;
  fill(tone.bg);
  doc.roundedRect(MARGIN, y, CW, vh, 10, 10, 'F');
  fill(tone.fg);
  doc.roundedRect(MARGIN, y, 5, vh, 2, 2, 'F');
  font('bold', 15, tone.fg);
  write(model.verdict.title, MARGIN + 22, y + 27);
  font('normal', 9.5, TEXT2);
  verdictLines.forEach((ln, i) => write(ln, MARGIN + 22, y + 46 + i * 13.5));
  y += vh + 20;

  // Stat tiles
  const gap = 10;
  const tileW = (CW - gap * (model.stats.length - 1)) / model.stats.length;
  model.stats.forEach((s, i) => {
    const tx = MARGIN + i * (tileW + gap);
    fill(WHITE);
    draw(LINE);
    doc.setLineWidth(0.6);
    doc.roundedRect(tx, y, tileW, 60, 8, 8, 'FD');
    font('bold', 16, INK, 'times');
    write(s.value, tx + 14, y + 30);
    font('bold', 6.8, MUTED);
    write(s.label.toUpperCase(), tx + 14, y + 47, { charSpace: 0.6 });
  });
  y += 60 + 26;

  // Breach table
  if (model.rows.length) {
    section(`Where it leaked (${model.rows.length})`);
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: 64, bottom: 70 },
      head: [['Service', 'Year', 'Records', 'Exposed data', 'Passwords', 'Verified']].map((r) => r.map(pdfText)),
      body: model.rows.map((r) => [`${r.name}\n${r.domain}`, r.year, r.records, r.data, r.passwords, r.verified].map(pdfText)),
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: { top: 5, right: 5, bottom: 5, left: 5 },
        textColor: TEXT2,
        lineColor: LINE,
        lineWidth: { bottom: 0.5 },
        overflow: 'linebreak',
        valign: 'top',
      },
      headStyles: { fillColor: ACCENT, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: ROW_ALT },
      // The exposed-data column takes whatever width is left, so the table always fills the text area.
      columnStyles: {
        0: { cellWidth: 130, textColor: INK },
        1: { cellWidth: 40 },
        2: { cellWidth: 52 },
        3: { cellWidth: CW - (130 + 40 + 52 + 75 + 40) },
        4: { cellWidth: 75 },
        5: { cellWidth: 40 },
      },
      showHead: 'everyPage',
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 4 && d.cell.raw === 'Plain text') {
          d.cell.styles.textColor = TONES.danger.fg;
          d.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawPage: () => chrome(),
    });
    y = doc.lastAutoTable.finalY + 26;
  } else if (model.found) {
    section('Where it leaked');
    font('normal', 9.5, TEXT2);
    write('No breach records were returned, but pastes contain this address (see the summary above).', MARGIN, y + 4);
    y += 30;
  }

  // Detailed breach write-ups
  if (model.details.length) {
    section(`Details for the ${model.details.length} most recent breaches`);
    for (const d of model.details) {
      const lines = wrap(limit(d.text, DESCRIPTION_LIMIT), CW - 28);
      const h = 34 + lines.length * 11.5 + 14;
      need(h + 10);
      fill(WHITE);
      draw(LINE);
      doc.setLineWidth(0.6);
      doc.roundedRect(MARGIN, y, CW, h, 8, 8, 'FD');
      font('bold', 10, INK);
      write(d.name, MARGIN + 14, y + 19);
      if (d.meta) {
        font('normal', 7.8, MUTED);
        write(d.meta, MARGIN + 14, y + 31);
      }
      font('normal', 8.6, TEXT2);
      lines.forEach((ln, i) => write(ln, MARGIN + 14, y + 47 + i * 11.5));
      y += h + 10;
    }
    y += 10;
  }

  // Checklist
  if (model.advice.length) {
    section('What to do now');
    for (const item of model.advice) {
      const lines = wrap(item.text, CW - 26);
      const h = 22 + lines.length * 11.5 + 12;
      need(h);
      const t = TONES[item.tone] ?? TONES.muted;
      draw(t.fg);
      doc.setLineWidth(0.9);
      doc.rect(MARGIN, y + 1, 9, 9);
      font('bold', 9.5, INK);
      write(item.title, MARGIN + 18, y + 9);
      font('normal', 8.8, TEXT2);
      lines.forEach((ln, i) => write(ln, MARGIN + 18, y + 22 + i * 11.5));
      y += h;
    }
    y += 6;
  }

  // Disclaimer
  const note = 'Generated locally by Josked from XposedOrNot data. Results can be incomplete, and a clean result does not prove an account is safe. Only check addresses you own or are allowed to check.';
  const noteLines = wrap(note, CW);
  need(noteLines.length * 11 + 16);
  font('normal', 7.8, MUTED);
  noteLines.forEach((ln, i) => write(ln, MARGIN, y + 8 + i * 11));

  // Footers, added last so the page count is known
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    draw(LINE);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, H - 44, W - MARGIN, H - 44);
    font('normal', 7.5, MUTED);
    write(`Josked · Breach report for ${model.email}`, MARGIN, H - 30);
    write(`Page ${i} of ${pages}`, W - MARGIN, H - 30, { align: 'right' });
  }

  return doc;
}
