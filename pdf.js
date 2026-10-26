/* lil'bakery Faktura: fakturan som PDF (A4) med jsPDF.
   draw() är en ren ritfunktion utan DOM och går att köra i Node (tests/pdf-render.mjs).
   render() laddar jsPDF, logga och typsnitt först när det behövs.
   I webbläsaren: window.FakturaPdf. I Node: require('./pdf.js'). */
(function (root) {
  'use strict';

  const calc = () => root.FakturaCalc || (typeof require === 'function' ? require('./calc.js') : null);

  // Samma färger som kassans kvitto.
  const COL = { ink: [47, 74, 77], muted: [109, 134, 136], brand: [59, 122, 128], pink: [196, 83, 106], line: [217, 233, 234], mist: [243, 248, 248], white: [255, 255, 255] };
  const M = 16;        // marginal i mm
  const CS = 0.45;     // bokstavsavstånd i små versalrubriker
  const LH = 4.3;      // radavstånd i brödtext
  const FONT_FILES = ['Nunito-Regular', 'Nunito-ExtraBold', 'Sacramento-Regular'];

  // Text som jsPDF klarar: med Nunito går hela Unicode utom emoji, utan typsnitt bara Latin-1.
  const pdfText = (t) => String(t ?? '').replace(/\u2212/g, '-').replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF\uFE0F]/gu, '').trim();
  const pdfLatin = (t) => pdfText(t).replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...').replace(/[^\x00-\xFF]/g, '').split(NB).join(' ');
  const has =(v) => String(v ?? '').trim() !== '';
  // "-" i Excel-mallen betyder tomt fält.
  const blank = (v) => !has(v) || /^[-–—\s]+$/.test(String(v));
  const NB = '\u00A0';

  function installFonts(doc, fonts) {
    if (!fonts || !FONT_FILES.every((n) => fonts[n])) return { body: 'helvetica', script: 'helvetica', scriptStyle: 'italic', unicode: false };
    if (!doc.getFontList().Nunito) {
      doc.addFileToVFS('Nunito-Regular.ttf', fonts['Nunito-Regular']); doc.addFont('Nunito-Regular.ttf', 'Nunito', 'normal');
      doc.addFileToVFS('Nunito-ExtraBold.ttf', fonts['Nunito-ExtraBold']); doc.addFont('Nunito-ExtraBold.ttf', 'Nunito', 'bold');
      doc.addFileToVFS('Sacramento-Regular.ttf', fonts['Sacramento-Regular']); doc.addFont('Sacramento-Regular.ttf', 'Sacramento', 'normal');
    }
    return { body: 'Nunito', script: 'Sacramento', scriptStyle: 'normal', unicode: true };
  }

  // Ritar hela fakturan på ett A4-dokument (jsPDF, unit mm). Lägger till sidor vid behov.
  function draw(doc, invoice, seller, assets) {
    const C = calc(); const inv = invoice || {}; const s = inv.saljare || seller || {}; const k = inv.kund || {};
    const A = assets || {}; const t = C.totals(inv);
    const F = installFonts(doc, A.fonts); const T = F.unicode ? pdfText : pdfLatin;
    const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight(); const R = W - M; const CW = R - M;
    const credit = inv.typ === 'kredit'; const final = C.isFinal(inv);
    const heading = credit ? 'Kreditfaktura' : 'Faktura';
    let D = true;   // false = mät bara höjden

    // ---------- Små hjälpare ----------
    const font = (bold, size, color) => { doc.setFont(F.body, bold ? 'bold' : 'normal'); doc.setFontSize(size); const c = color || COL.ink; doc.setTextColor(c[0], c[1], c[2]); };
    const text = (str, x, y, opts) => { const v = T(str); if (D && v) doc.text(v, x, y, opts || {}); };
    const tw = (str) => doc.getTextWidth(T(str));
    const wrap = (str, w) => { const v = T(str); return v ? doc.splitTextToSize(v, w) : []; };
    const hr = (x1, y, x2, c, lw) => { if (!D) return; const k2 = c || COL.line; doc.setDrawColor(k2[0], k2[1], k2[2]); doc.setLineWidth(lw || 0.25); doc.line(x1, y, x2, y); };
    const box = (x, y, w, h, c, r) => { if (!D) return; doc.setFillColor(c[0], c[1], c[2]); doc.roundedRect(x, y, w, h, r, r, 'F'); };
    // Versalrubrik med bokstavsavstånd. Bredden räknas själv så att högerjustering hamnar exakt.
    const capsW = (str) => { const u = T(str).toUpperCase(); return doc.getTextWidth(u) + CS * Math.max(0, u.length - 1); };
    const caps = (str, x, y, align) => {
      const u = T(str).toUpperCase(); const w = capsW(str);
      const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      if (D && u) { doc.setCharSpace(CS); doc.text(u, x0, y); doc.setCharSpace(0); }
    };
    // Krymper teckenstorleken tills texten får plats.
    const fitSize = (str, bold, size, maxW, min) => { let sz = size; font(bold, sz); while (sz > min && tw(str) > maxW) { sz -= 0.25; font(bold, sz); } return sz; };
    const money = C.money; const kr = C.kr;
    const qtyText = (c, l) => `${C.num(c.qty)}${has(l.unit) ? NB + String(l.unit).trim() : ''}`;

    // ---------- Sidfot (samma på alla sidor) ----------
    const droj = credit ? '' : (s.drojsmalsranta || '');
    font(false, 7, COL.muted); const drojLines = wrap(droj, CW - 30);
    const FOOT_BASE = H - 14;                 // sista raden i sidfoten
    const FOOT_HR = FOOT_BASE - 11.6;         // linjen ovanför sidfoten
    const NOTE_Y = FOOT_HR - 3;               // dröjsmålsränta och sidnummer
    const LIMIT = NOTE_Y - 3.2 * Math.max(0, drojLines.length - 1) - 9;   // innehållet slutar här
    const footCols = [
      { x: M, align: 'left', rows: [[s.foretag, true], [s.adress], [[s.postnr, s.ort].filter(has).join(' ')]] },
      { x: W / 2, align: 'center', rows: [[has(s.telefon) ? `Tel ${s.telefon}` : ''], [s.epost], [s.webb]] },
      { x: R, align: 'right', rows: [[has(s.orgnr) ? `Org.nr ${s.orgnr}` : ''], [has(s.momsregnr) ? `Momsreg.nr ${s.momsregnr}` : ''], [s.fskatt ? 'Godkänd för F-skatt' : '']] }
    ];
    function footer(page, pages) {
      font(false, 7, COL.muted);
      drojLines.forEach((p, i) => text(p, M, NOTE_Y - (drojLines.length - 1 - i) * 3.2));
      text(`Sida ${page} av ${pages}`, R, NOTE_Y, { align: 'right' });
      hr(M, FOOT_HR, R);
      const colW = CW / 3 - 4;
      footCols.forEach((col) => {
        let y = FOOT_HR + 4.6;
        col.rows.filter((r) => has(r[0])).forEach(([v, bold]) => {
          const sz = fitSize(v, !!bold, 7.4, colW, 5.5); font(!!bold, sz, bold ? COL.ink : COL.muted);
          text(v, col.x, y, col.align === 'left' ? {} : { align: col.align }); y += 3.5;
        });
      });
    }

    // ---------- Vattenstämpel på utkast, genomskinlig ovanpå allt ----------
    // Utan genomskinlighet (äldre jsPDF) räcker etiketten UTKAST i sidhuvudet.
    function watermark() {
      if (typeof doc.GState !== 'function' || typeof doc.setGState !== 'function') return;
      const size = 110; const deg = 33; const a = deg * Math.PI / 180;
      font(true, size, COL.pink); const w = tw('UTKAST'); const capH = size * 0.3528 * 0.7;
      const bx = W / 2 + (capH / 2) * Math.sin(a); const by = H / 2 + (capH / 2) * Math.cos(a);
      doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.12 }));
      doc.text('UTKAST', bx - (w / 2) * Math.cos(a), by + (w / 2) * Math.sin(a), { angle: deg });
      doc.restoreGraphicsState();
    }

    // ---------- Sidhuvud på första sidan ----------
    const KV_X = R - 74;          // vänsterkant för fakturauppgifterna och kundblocket
    function header(y0) {
      const logo = A.logo; const logoW = 36; const logoH = logo ? logoW * logo.ratio : 0;
      if (logo) { if (D) doc.addImage(logo.data, 'PNG', M, y0, logoW, logoH, 'fakturalogo'); }
      else { const sz = fitSize(s.foretag || '', true, 20, KV_X - M - 10, 11); font(true, sz, COL.brand); text(s.foretag || '', M, y0 + 9); }
      const leftBottom = y0 + (logo ? logoH : 12);
      font(true, 26, COL.ink); text(heading, R, y0 + 9, { align: 'right' });
      let y = y0 + 9;
      if (credit && inv.krediterar) {
        y += 6.4; font(false, 9.5, COL.muted);
        text(`Avser faktura ${inv.krediterar.nr ?? ''}${has(inv.krediterar.datum) ? ` (${inv.krediterar.datum})` : ''}`, R, y, { align: 'right' });
      }
      if (!final) {
        font(true, 7.5); const pw = capsW('Utkast') + 7; y += 3.2;
        box(R - pw, y, pw, 5.6, COL.pink, 2.8); font(true, 7.5, COL.white); caps('Utkast', R - pw / 2, y + 3.9, 'center'); y += 5.6;
      }
      y += 8;
      const v = Number(inv.villkor);
      const villkor = Number.isFinite(v) && has(inv.villkor) ? (v > 0 ? `${C.num(v)} dagar netto` : 'Netto kontant') : '';
      const rows = [
        final ? ['Fakturanummer', String(inv.nr)] : null,
        ['Fakturadatum', inv.datum],
        credit ? null : ['Förfallodag', inv.forfallodag],
        ['Leveransdatum', inv.leveransdatum],
        credit ? null : ['Betalningsvillkor', villkor],
        ['Vår referens', inv.varRef], ['Er referens', inv.erRef], ['Märkning', inv.markning]
      ].filter((r) => r && !blank(r[1]));
      let last = y;
      rows.forEach(([lab, val]) => {
        font(false, 9, COL.muted); text(lab, KV_X, y);
        font(true, 9, COL.ink); const parts = wrap(val, R - KV_X - 30);
        parts.forEach((p, i) => text(p, R, y + i * LH, { align: 'right' }));
        last = y + (parts.length - 1) * LH; y = last + LH + 0.7;
      });
      return Math.max(leftBottom, last + 1.5);
    }

    // ---------- Från och Faktureras till ----------
    function parties(y0) {
      font(true, 7, COL.muted); caps('Från', M, y0); caps('Faktureras till', KV_X, y0);
      const block = (x, w, name, rows) => {
        let y = y0 + 6.2; let last = y0;
        font(true, 10.5, COL.ink); wrap(name, w).forEach((p) => { text(p, x, y); last = y; y += 4.8; });
        font(false, 9, COL.ink); rows.filter(has).forEach((r) => wrap(r, w).forEach((p) => { text(p, x, y); last = y; y += LH; }));
        return last;
      };
      const zipCity = (o) => [o.postnr, o.ort].filter(has).join(' ');
      const l = block(M, KV_X - M - 10, s.foretag, [s.adress, zipCity(s), has(s.orgnr) ? `Org.nr ${s.orgnr}` : '', has(s.momsregnr) ? `Momsreg.nr ${s.momsregnr}` : '']);
      const r = block(KV_X, R - KV_X, k.namn, [k.adress, zipCity(k), k.land, has(k.orgnr) ? `Org.nr ${k.orgnr}` : '', k.epost]);
      return Math.max(l, r) + 1.5;
    }

    // ---------- Radtabell ----------
    const X = { name: M + 3, qty: M + 100, price: M + 127, vat: M + 144, sum: R - 3 };
    const TH = 10.5;   // tabellhuvudets höjd
    const ROW = 7.2;   // en tabellrad med en textrad
    function tableHeader(y) {
      box(M, y, CW, TH, COL.mist, 2);
      font(true, 7, COL.muted);
      const one = y + 6.3; const a = y + 4.6; const b = y + 8;
      caps('Benämning', X.name, one); caps('Antal', X.qty, one, 'right');
      caps('À-pris', X.price, a, 'right'); caps('exkl. moms', X.price, b, 'right');
      caps('Moms', X.vat, one, 'right');
      caps('Belopp', X.sum, a, 'right'); caps('exkl. moms', X.sum, b, 'right');
      return y + TH;
    }
    // Höjden på en rad. Ritar den när D är sant.
    function lineRow(l, c, y) {
      const base = y + 4.85;
      if (c.text) {
        font(false, 9, COL.muted); const parts = wrap(l.name, X.sum - X.name);
        parts.forEach((p, i) => text(p, X.name, base + i * LH));
        const h = ROW + LH * (parts.length - 1); hr(M, y + h, R); return h;
      }
      // Talen krymper hellre än att de krockar med spalten intill (bara vid orimligt stora belopp).
      const cell = (str, x, bold, color, maxW) => { const sz = fitSize(str, bold, 9.5, maxW, 6); font(bold, sz, color); text(str, x, base, { align: 'right' }); return Math.min(tw(str), maxW); };
      const q = qtyText(c, l); font(false, 9.5); const qw = Math.min(tw(q), 40);
      font(false, 9.5, COL.ink); const parts = wrap(l.name, Math.min(X.qty - qw - 6, X.qty - 18) - X.name);
      parts.forEach((p, i) => text(p, X.name, base + i * LH));
      cell(q, X.qty, false, COL.ink, 40);
      cell(money(c.unitExkl), X.price, false, COL.ink, X.price - X.qty - 4);
      cell(`${C.num(c.rate)}${NB}%`, X.vat, false, COL.muted, 12);
      cell(money(c.net), X.sum, true, COL.ink, X.sum - X.vat - 4);
      const h = ROW + LH * (Math.max(1, parts.length) - 1); hr(M, y + h, R); return h;
    }

    // ---------- Följesidor ----------
    const CONT_Y = M + 13;      // där innehållet börjar på sida 2 och framåt
    function newPage(withTable) {
      doc.addPage();
      const y = CONT_Y - 9;
      font(true, 11, COL.ink); const head = final ? `${heading} ${inv.nr}` : `${heading}, utkast`; text(head, M, y);
      const hw = tw(head);
      const nameMax = CW - hw - 12; const sz = fitSize(k.namn || '', false, 9, nameMax, 6.5); font(false, sz, COL.muted);
      const nm = wrap(k.namn || '', nameMax)[0] || ''; text(nm, R, y, { align: 'right' });
      hr(M, y + 3.5, R);
      return withTable ? tableHeader(y + 9) : y + 9;
    }

    // ---------- Summering, meddelande, betalning och hälsning ----------
    function tail(y0) {
      const tx = X.qty - 4; const sumW = X.sum - tx;
      let y = y0 + 9;
      // Meddelande till vänster om summeringen
      let yl = y - 4;
      if (has(inv.meddelande)) {
        font(true, 7, COL.muted); caps('Meddelande', M, y); let yy = y + 5.6;
        font(false, 9.2, COL.ink); wrap(inv.meddelande, tx - M - 14).forEach((p) => { text(p, M, yy); yl = yy; yy += LH + 0.2; });
      }
      // Summering till höger, beloppen på samma kant som tabellen
      const row = (lab, val, color) => {
        let sz = 9; while (sz > 7 && (font(false, sz), tw(lab) + tw(val) + 5 > sumW)) sz -= 0.25;
        font(false, sz, color || COL.muted); text(lab, tx, y); font(false, sz, COL.ink); text(val, X.sum, y, { align: 'right' }); y += 5.2;
      };
      row('Summa exkl. moms', money(t.net));
      t.rows.forEach((r) => row(`Moms ${C.num(r.rate)}${NB}% på ${money(r.net)}`, money(r.vat)));
      if (t.rows.length > 1) row('Moms totalt', money(t.vat));
      if (t.rounding) row('Öresavrundning', money(t.rounding));
      y -= 1.4; hr(tx, y, R, COL.brand, 0.45); y += 7.6;
      const lab = credit ? 'Kreditbelopp' : 'Att betala'; const big = kr(t.toPay);
      const fits = (sz) => { font(true, 11.5); const lw = tw(lab); font(true, sz); return lw + tw(big) + 6 <= sumW; };
      let sz = 17; while (sz > 13 && !fits(sz)) sz -= 0.5;
      if (fits(sz)) { font(true, 11.5, COL.brand); text(lab, tx, y); font(true, sz, COL.brand); text(big, X.sum, y, { align: 'right' }); }
      else { font(true, 11.5, COL.brand); text(lab, tx, y); y += 7.5; const bs = fitSize(big, true, 17, sumW, 9); font(true, bs, COL.brand); text(big, X.sum, y, { align: 'right' }); }
      y = Math.max(yl, y) + 10;

      // Betalningsrutan
      const cells = credit
        ? [['Avser faktura', inv.krediterar ? inv.krediterar.nr : ''], ['Kreditbelopp', big]]
        : [['Förfallodag', inv.forfallodag], ['Att betala', big], ['Plusgiro', s.plusgiro], ['Bankgiro', s.bankgiro], ['Swish', s.swish], ['IBAN', s.iban], ['BIC', s.bic]];
      const pad = 6; const inner = CW - 2 * pad; const gap = 12;
      // Rutorna läggs i rad. Blir det en andra rad hamnar rutorna i samma spalter som i första raden.
      let cx = M + pad; let cy = y + pad + 2.6; const placed = []; const stops = []; let line2 = 0;
      cells.filter((c) => has(c[1])).forEach(([lab2, val]) => {
        font(true, 7); const w1 = capsW(lab2); font(true, 10.5); const w2 = tw(val); const w = Math.max(w1, w2);
        if (line2) { const snap = stops.find((sx) => sx >= cx); if (snap != null) cx = snap; }
        if (cx > M + pad && cx + w > M + pad + inner) { cx = M + pad; cy += 12; line2++; }
        if (!line2) stops.push(cx);
        placed.push([lab2, val, cx, cy]); cx += w + gap;
      });
      const note = credit ? 'Beloppet krediteras. Ingen betalning ska göras.'
        : final ? `Ange fakturanummer ${inv.nr} som meddelande vid betalning.` : 'Ange fakturanumret som meddelande vid betalning.';
      font(credit, 9.5); const noteLines = wrap(note, inner);
      let ny = cy + 5.6 + 7.4; const boxH = ny + LH * (noteLines.length - 1) + pad - 1.6 - y;
      box(M, y, CW, boxH, COL.mist, 2.5);
      placed.forEach(([lab2, val, px, py]) => { font(true, 7, COL.muted); caps(lab2, px, py); font(true, 10.5, COL.ink); text(val, px, py + 5.6); });
      font(credit, 9.5, COL.ink); noteLines.forEach((p) => { text(p, M + pad, ny); ny += LH; });
      y += boxH;

      // Hälsning i skrivstil
      if (!credit && has(s.fakturaText)) {
        y += F.unicode ? 15.5 : 10;
        doc.setFont(F.script, F.scriptStyle); doc.setFontSize(F.unicode ? 26 : 14); doc.setTextColor(COL.brand[0], COL.brand[1], COL.brand[2]);
        wrap(s.fakturaText, CW - 40).forEach((p, i) => { if (i) y += F.unicode ? 9 : 6; text(p, W / 2, y, { align: 'center' }); });
        y += 2;
      }
      return y;
    }

    // ---------- Rita ----------
    doc.setProperties({ title: C.title(inv), subject: `${C.title(inv)}${has(k.namn) ? ' till ' + k.namn : ''}`, author: s.foretag || '', creator: "lil'bakery Faktura" });
    let y = header(M);
    y = parties(y + 10) + 10;
    y = tableHeader(y);
    const shown = (inv.lines || []).map((l, i) => [l, t.lines[i]]).filter(([l]) => !C.isEmptyLine(l));
    if (!shown.length) { font(false, 9, COL.muted); text('Inga rader ännu.', X.name, y + 4.85); y += ROW; hr(M, y, R); }
    D = false; const hs = shown.map(([l, c]) => lineRow(l, c, 0)); const tailH = tail(0); D = true;
    const rest = (i) => hs.slice(i).reduce((a, b) => a + b, 0);
    let onPage = 0;
    shown.forEach(([l, c], i) => {
      let brk = y + hs[i] > LIMIT;
      // De två sista raderna följer med summeringen till nästa sida, så att den inte står ensam.
      if (!brk && onPage > 0 && i >= shown.length - 2 && y + rest(i) + tailH > LIMIT && CONT_Y + TH + rest(i) + tailH <= LIMIT) brk = true;
      if (brk) { y = newPage(true); onPage = 0; }
      y += lineRow(l, c, y); onPage++;
    });
    if (y + tailH > LIMIT) y = newPage(false) - 6;
    tail(y);
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) { doc.setPage(p); footer(p, pages); if (!final) watermark(); }
    return doc;
  }

  // ---------- Webbläsaren: ladda bibliotek, logga och typsnitt ----------
  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script'); el.src = src; el.onload = resolve;
      el.onerror = () => { delete scripts[src]; reject(new Error('Kunde inte ladda ' + src)); };
      document.head.appendChild(el);
    }));
  }
  function loadLogo(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try { const w = 480; const h = Math.round(img.naturalHeight * w / img.naturalWidth); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); resolve({ data: c.toDataURL('image/png'), ratio: h / w }); } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  function loadFonts(base) {
    return Promise.all(FONT_FILES.map((n) => fetch(`${base}vendor/fonts/${n}.ttf`)
      .then((res) => { if (!res.ok) throw new Error(n); return res.arrayBuffer(); })
      .then((buf) => { const b = new Uint8Array(buf); let str = ''; for (let i = 0; i < b.length; i += 0x8000) str += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return [n, str]; })))
      .then((list) => Object.fromEntries(list))
      .catch(() => null);
  }
  const assetCache = {};
  // Saknas loggan eller typsnitten blir PDF:en ändå klar, med text i stället för logga och Helvetica.
  function loadAssets(base = '') {
    if (!assetCache[base]) {
      assetCache[base] = Promise.all([loadLogo(`${base}img/logo.png`), loadFonts(base)])
        .then(([logo, fonts]) => { if (!logo || !fonts) delete assetCache[base]; return { logo, fonts }; });
    }
    return assetCache[base];
  }
  async function render(invoice, opts) {
    const o = opts || {}; const base = o.base || '';
    if (!(root.jspdf && root.jspdf.jsPDF)) await loadScript(`${base}vendor/jspdf.umd.min.js`);
    const assets = await loadAssets(base);
    const doc = new root.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'p', compress: true });
    draw(doc, invoice, o.seller, assets);
    return doc.output('blob');
  }
  const filename = (invoice) => calc().filename(invoice);

  const api = { draw, render, loadAssets, filename, COL };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FakturaPdf = api;
})(typeof self !== 'undefined' ? self : this);
