/* lil'bakery Faktura: läser gamla fakturor från Excel-mallen (Isolta, .xlsx).
   XML:en tolkas med reguljära uttryck utan DOM, så att parseXlsx också går att köra i Node.
   I webbläsaren: window.FakturaImport (laddar vendor/jszip.min.js först när den behövs). I Node: require('./import.js'). */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && !!module.exports && typeof require === 'function';
  const Calc = (root && root.FakturaCalc) || (isNode ? require('./calc.js') : null);

  // ---------- JSZip, laddas vid första importen ----------
  let zipLib = null;
  function loadZip() {
    if (zipLib) return zipLib;
    if (root && root.JSZip) return (zipLib = Promise.resolve(root.JSZip));
    if (isNode) return (zipLib = Promise.resolve(require('./vendor/jszip.min.js')));
    zipLib = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = (api.base || '') + 'vendor/jszip.min.js';
      s.onload = () => (root.JSZip ? resolve(root.JSZip) : reject(new Error('Kunde inte starta Excel-läsaren.')));
      s.onerror = () => { zipLib = null; reject(new Error('Kunde inte ladda Excel-läsaren. Kontrollera internetanslutningen och försök igen.')); };
      document.head.appendChild(s);
    });
    return zipLib;
  }

  // ---------- XML ----------
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = (s) => String(s ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => (g[0] === '#' ? String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ENT[g.toLowerCase()]))
    .replace(/_x([0-9a-f]{4})_/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));   // Excels egen kodning av styrtecken
  function attr(attrs, name) {
    const m = new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(attrs || '');
    return m ? decode(m[1] != null ? m[1] : m[2]) : null;
  }
  // Texten i alla <t> (även formaterade delar, "rich text"), utan uttalshjälp <rPh>.
  function textOf(xml) {
    const s = String(xml || '').replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
    const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g; let m; let out = '';
    while ((m = re.exec(s))) out += decode(m[1]);
    return out;
  }
  function sharedStrings(xml) {
    const out = []; const re = /<(?:\w+:)?si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g; let m;
    while ((m = re.exec(xml || ''))) out.push(textOf(m[1] || ''));
    return out;
  }
  const colNum = (letters) => { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const colName = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

  // Alla celler med värde: { A1: { v, t } }. Formler läses som sitt sparade resultat (<v>).
  function readCells(sheetXml, strings) {
    const cells = {}; const sst = strings || [];
    const data = (/<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/.exec(sheetXml || '') || [])[1] || '';
    const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g; let rm; let rowNr = 0;
    while ((rm = rowRe.exec(data))) {
      const rn = Number(attr(rm[1], 'r')); rowNr = rn > 0 ? rn : rowNr + 1;
      const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g; let cm; let col = 0;
      while ((cm = cellRe.exec(rm[2] || ''))) {
        const ref = attr(cm[1], 'r'); const mm = ref ? /^([A-Z]+)(\d+)$/i.exec(ref) : null;
        col = mm ? colNum(mm[1]) : col + 1;
        const inner = cm[2] || ''; const t = attr(cm[1], 't') || 'n';
        const vm = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner); const raw = vm ? decode(vm[1]) : null;
        let v = null;
        if (t === 's') v = raw != null && raw.trim() !== '' ? (sst[Number(raw)] ?? null) : null;
        else if (t === 'inlineStr') v = textOf((/<(?:\w+:)?is(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?is>/.exec(inner) || [])[1] || '');
        else if (t === 'str' || t === 'd') v = raw;            // formelns resultat som text, eller ISO-datum
        else if (t === 'b') v = raw == null ? null : raw.trim() === '1';
        else if (t === 'e') v = null;                          // #DIVISION/0! och liknande
        else v = raw == null || raw.trim() === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : raw);
        if (v === null || v === '') continue;
        cells[colName(col) + (mm ? mm[2] : rowNr)] = { v, t };
      }
    }
    return cells;
  }

  // ---------- Datum ----------
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(y, m, d) {
    const Y = Number(y); const M = Number(m); const D = Number(d);
    if (!(Y > 1900 && Y < 2200 && M >= 1 && M <= 12 && D >= 1 && D <= 31)) return '';
    const dt = new Date(Date.UTC(Y, M - 1, D)); if (dt.getUTCMonth() !== M - 1) return '';
    return `${Y}-${pad(M)}-${pad(D)}`;
  }
  // Excels serietal: 1900-systemet räknar från 1899-12-30 (Excels skottårsfel med), 1904-systemet från 1904-01-01.
  function excelDate(serial, date1904) {
    const n = Math.floor(Number(serial)); if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date((date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + n * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  function textDate(v) {
    const s = String(v ?? '').trim(); let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return ymd(m[1], m[2], m[3]);
    if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s))) return ymd(m[3], m[2], m[1]);   // 5.5.2026, dag först
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return ymd(m[1], m[2], m[3]);
    return '';
  }

  // ---------- Hjälp för mallens celler ----------
  function reader(cells, date1904) {
    const get = (ref) => (cells[ref] ? cells[ref].v : null);
    const str = (ref) => { const v = get(ref); if (v == null || typeof v === 'boolean') return ''; return String(v).replace(/[\s\u00a0]+/g, ' ').trim(); };
    const num = (ref) => { const v = get(ref); if (typeof v === 'number') return v; if (v == null || typeof v === 'boolean') return null; return Calc.parseNum(v); };
    const date = (ref) => { const v = get(ref); return typeof v === 'number' ? excelDate(v, date1904) : textDate(v); };
    return { get, str, num, date };
  }
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const orgnrLike = (s) => /^\d{6}(\d{2})?-?\d{4}$/.test(String(s || '').replace(/\s/g, ''));
  function fmtOrgnr(s) {
    const d = digits(s);
    if (orgnrLike(s) && d.length === 10) return `${d.slice(0, 6)}-${d.slice(6)}`;
    if (orgnrLike(s) && d.length === 12) return `${d.slice(0, 8)}-${d.slice(8)}`;
    return String(s || '').trim();
  }
  const POST_RE = /^(?:SE-?\s*)?(\d{3})\s?(\d{2})\s+(.+)$/i;
  function splitPostOrt(s) {
    const m = POST_RE.exec(String(s || '').trim());
    return m ? { postnr: `${m[1]} ${m[2]}`, ort: m[3].trim() } : { postnr: '', ort: String(s || '').trim() };
  }
  const vatPercent = (k) => (k == null ? null : Math.round((k <= 1 ? k * 100 : k) * 100) / 100);
  const round6 = (n) => Math.round(n * 1e6) / 1e6;
  const stripLabel = (s) => String(s || '').replace(/^(tel(efon)?|tfn|mobil|phone|e-?post|e-?mail|mail)\.?\s*:?\s*/i, '').trim();

  // Hur väl ett namn stämmer med e-postadressens första del (eva.exempel@ ger träff på "Eva Exempel").
  function emailScore(name, email) {
    const local = fold(String(email || '').split('@')[0]); if (!local || !name) return 0;
    const parts = tokens(local); const compact = local.replace(/[^a-z0-9]/g, '');
    return tokens(name).filter((t) => parts.includes(t) || (t.length >= 3 && compact.includes(t))).length;
  }
  // Mallen har Vår referens i E11 och Er referens i E12, men de är ofta omkastade.
  // Den som stämmer med kundens e-post är kundens kontakt (Er referens), den som stämmer med säljarens är Vår referens.
  function pickRefs(e11, e12, c11, c12, customerEmail, sellerEmail) {
    const c11Er = /^\s*er\b/i.test(c11); const c12Er = /^\s*er\b/i.test(c12);
    let er = c11Er && !c12Er ? e11 : e12; let vr = er === e11 ? e12 : e11;
    const s11 = emailScore(e11, customerEmail) - emailScore(e11, sellerEmail);
    const s12 = emailScore(e12, customerEmail) - emailScore(e12, sellerEmail);
    if (s11 > s12) { er = e11; vr = e12; } else if (s12 > s11) { er = e12; vr = e11; }
    return { erRef: er || '', varRef: vr || '' };
  }

  // ---------- En faktura ----------
  const FIRST_ROW = 20; const LAST_ROW = 39;
  // cells från readCells. Ger { invoice | null, seller, warnings }.
  function parseSheet(cells, file, opts) {
    const o = opts || {}; const x = reader(cells || {}, o.date1904); const warnings = []; const name = file || 'Filen';
    const nr = x.num('L4');
    if (!(Number.isInteger(nr) && nr > 0)) {
      warnings.push(`${name}: hittar inget fakturanummer i cell L4. Filen ser inte ut som Excel-fakturamallen och hoppades över.`);
      return { invoice: null, seller: {}, warnings };
    }
    const marks = [/nummer|nr/i.test(x.str('J4')), /datum/i.test(x.str('J5')), /namn|benämning|beskrivning|artikel/i.test(x.str('C19')), /referens/i.test(x.str('C11') + x.str('C12'))];
    if (marks.filter(Boolean).length < 2) warnings.push(`${name}: ser inte ut exakt som Excel-fakturamallen. Kontrollera de inlästa uppgifterna.`);

    const datum = x.date('L5');
    if (!datum) warnings.push(`${name}: fakturadatum saknas i cell L5.`);
    const leveransdatum = x.date('E9') || datum;
    let villkor = (/(\d+)/.exec(x.str('E10')) || [])[1]; villkor = villkor != null ? Number(villkor) : null;
    const dueCell = x.date('L6');
    if (villkor == null && datum && dueCell) { const d = Calc.daysBetween(datum, dueCell); if (d != null && d >= 0) villkor = d; }
    if (villkor == null) { villkor = 30; warnings.push(`${name}: betalningsvillkor saknas i cell E10, 30 dagar används.`); }
    const forfallodag = datum ? Calc.addDays(datum, villkor) : '';

    // Säljaren från sidfoten, med sidhuvudet som reserv.
    const footer = ['E53', 'E54', 'E55'].map((r) => stripLabel(x.str(r))).filter(Boolean);
    const seller = {
      foretag: x.str('C53') || x.str('E3'),
      adress: x.str('C54') || x.str('E4'),
      ...splitPostOrt(x.str('C55') || x.str('E5')),
      telefon: footer.find((s) => !s.includes('@') && /^[+\d][\d\s()-]{5,}$/.test(s)) || '',
      epost: footer.find((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) || '',
      orgnr: fmtOrgnr(x.str('L53'))
    };
    const payLabel = x.str('L51'); const payNr = x.str('L52');
    if (payNr) {
      if (/plus\s*giro|^pg\b/i.test(payLabel)) seller.plusgiro = payNr;
      else if (/bank\s*giro|^bg\b/i.test(payLabel)) seller.bankgiro = payNr;
      else if (/swish/i.test(payLabel)) seller.swish = payNr;
      else warnings.push(`${name}: betalningsuppgiften i cell L52 har ingen känd rubrik (plusgiro eller bankgiro) och lästes inte in.`);
    }
    const footText = Object.keys(cells || {}).filter((ref) => Number(ref.replace(/^[A-Z]+/, '')) >= 50).map((ref) => x.str(ref)).join(' ');
    if (/f-?skatt/i.test(x.str('J54')) || /godk[äa]nd\s+för\s+f-?skatt/i.test(footText)) seller.fskatt = true;

    // Kunden. J10 är organisationsnummer, utom för privatpersoner där adressen kan börja redan där.
    const customerEmail = x.str('J13');
    const kund = { namn: x.str('J9'), orgnr: '', adress: '', postnr: '', ort: '', land: '', kontakt: '', epost: /@/.test(customerEmail) ? customerEmail : '', telefon: '' };
    const addr = orgnrLike(x.str('J10')) ? [x.str('J11'), x.str('J12')] : [x.str('J10'), x.str('J11'), x.str('J12')];
    if (orgnrLike(x.str('J10'))) kund.orgnr = fmtOrgnr(x.str('J10'));
    const parts = addr.filter(Boolean); const postIdx = parts.findIndex((p) => POST_RE.test(p));
    if (postIdx >= 0) { Object.assign(kund, splitPostOrt(parts[postIdx])); kund.adress = parts.filter((p, i) => i !== postIdx).join(', '); }
    else kund.adress = parts.join(', ');

    const refs = pickRefs(x.str('E11'), x.str('E12'), x.str('C11'), x.str('C12'), customerEmail, seller.epost);
    kund.kontakt = refs.erRef;
    if (refs.varRef) seller.namn = refs.varRef;

    // Rader 20–39. Dold kolumn S = pris inklusive moms, annars J = á-pris exklusive moms.
    const raw = [];
    for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
      const l = { r, name: x.str('C' + r), qty: x.num('H' + r), unit: x.str('I' + r), inkl: x.num('S' + r), exkl: x.num('J' + r), vat: vatPercent(x.num('K' + r)) };
      if (!l.name && l.qty == null && l.inkl == null && l.exkl == null) continue;
      raw.push(l);
    }
    const priceMode = raw.some((l) => l.inkl != null) ? 'inkl' : 'exkl';
    const lines = raw.map((l) => {
      const priced = l.qty != null && (l.inkl != null || l.exkl != null);
      if (priced && l.vat == null) warnings.push(`${name}, rad ${l.r}: momssats saknas i kolumn K och räknas som 0 %.`);
      const vat = l.vat == null ? 0 : l.vat;
      let price = priceMode === 'inkl' ? (l.inkl != null ? l.inkl : l.exkl != null ? l.exkl * (1 + vat / 100) : null) : l.exkl;
      price = price == null ? null : round6(price);
      return { id: Calc.uid(), name: l.name, qty: l.qty == null ? '' : l.qty, unit: l.unit, price, vat };
    });
    if (!lines.some(Calc.hasAmount)) warnings.push(`${name}: hittar inga rader med antal och pris (rad ${FIRST_ROW}–${LAST_ROW}).`);
    const total = Calc.totals({ priceMode, lines }).gross; const excelTotal = x.num('L46') ?? x.num('L49');
    if (excelTotal != null && Math.abs(excelTotal - total) > 0.1) warnings.push(`${name}: summan i filen (${Calc.kr(excelTotal)}) skiljer sig från uträkningen (${Calc.kr(total)}). Kontrollera raderna.`);

    const meddelande = [16, 17, 18].map((r) => x.str('C' + r)).filter(Boolean).join('\n');
    const invoice = {
      file: name, nr, typ: /kredit/i.test(x.str('J3')) ? 'kredit' : 'faktura', datum, leveransdatum, villkor, forfallodag,
      varRef: refs.varRef, erRef: refs.erRef, markning: x.str('E13'), meddelande, kund, lines, priceMode
    };
    return { invoice, seller, warnings };
  }

  // ---------- En fil ----------
  async function zipText(zip, path) { const f = zip.file(path); return f ? f.async('string') : ''; }
  function relTargets(relsXml) {
    const out = []; const re = /<(?:\w+:)?Relationship\b([^>]*?)\/?>/g; let m;
    while ((m = re.exec(relsXml || ''))) out.push({ id: attr(m[1], 'Id'), type: attr(m[1], 'Type') || '', target: attr(m[1], 'Target') || '' });
    return out;
  }
  const xlPath = (target) => (target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
  // data: ArrayBuffer eller Uint8Array. Ger { invoice | null, seller, warnings }, kastar Error om filen inte går att öppna.
  async function parseXlsx(data, filename) {
    const name = filename || 'Filen'; const JSZip = await loadZip();
    let zip;
    try { zip = await JSZip.loadAsync(data); } catch (e) { throw new Error(`${name}: kunde inte öppnas som Excel-fil (.xlsx). Är filen lösenordsskyddad, öppna den i Excel och spara den utan lösenord.`); }
    const wb = await zipText(zip, 'xl/workbook.xml');
    if (!wb) throw new Error(`${name}: är ingen Excel-arbetsbok (.xlsx).`);
    const rels = relTargets(await zipText(zip, 'xl/_rels/workbook.xml.rels'));
    const first = /<(?:\w+:)?sheet\b([^>]*?)\/?>/.exec(wb);
    const rid = first ? (/\b[\w]+:id\s*=\s*"([^"]*)"/.exec(first[1]) || [])[1] : null;
    const rel = rels.find((r) => r.id === rid);
    let sheetPath = rel ? xlPath(rel.target) : '';
    if (!sheetPath || !zip.file(sheetPath)) sheetPath = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort()[0] || '';
    if (!sheetPath) throw new Error(`${name}: hittar inget kalkylblad i filen.`);
    const sstRel = rels.find((r) => /\/sharedStrings$/.test(r.type));
    const strings = sharedStrings(await zipText(zip, sstRel ? xlPath(sstRel.target) : 'xl/sharedStrings.xml'));
    const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*"(1|true)"/i.test(wb);
    return parseSheet(readCells(await zipText(zip, sheetPath), strings), name, { date1904 });
  }

  // ---------- Flera filer ----------
  function readBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(file); });
  }
  const filled = (obj) => { const o = {}; Object.keys(obj).forEach((k) => { if (obj[k] !== '' && obj[k] != null) o[k] = obj[k]; }); return o; };
  // Slår ihop fakturorna: kunder unika på orgnr (annars namn), artiklar unika på namn, senaste fakturan vinner.
  function combine(parsed, warnings) {
    const out = { seller: {}, customers: [], items: [], invoices: [], maxNr: null, warnings: warnings || [] };
    const order = parsed.slice().sort((a, b) => String(a.invoice.datum).localeCompare(String(b.invoice.datum)) || a.invoice.nr - b.invoice.nr);
    const byNr = new Map();
    order.forEach((p) => {
      const prev = byNr.get(p.invoice.nr);
      if (prev) out.warnings.push(`Fakturanummer ${p.invoice.nr} finns i flera filer (${prev.invoice.file} och ${p.invoice.file}). Bara ${p.invoice.file} används.`);
      byNr.set(p.invoice.nr, p);
    });
    const used = order.filter((p) => byNr.get(p.invoice.nr) === p);
    const customers = []; const items = new Map();
    used.forEach((p) => {
      const inv = p.invoice; const k = inv.kund;
      Object.assign(out.seller, filled(p.seller));
      if (k.namn || k.orgnr) {
        const d = digits(k.orgnr); const n = fold(k.namn).trim();
        let c = customers.find((x) => { const xd = digits(x.orgnr); return d.length >= 10 && xd.length >= 10 ? xd === d : !!n && fold(x.namn).trim() === n; });
        if (!c) { c = { id: Calc.uid(), namn: '', orgnr: '', adress: '', postnr: '', ort: '', land: '', kontakt: '', epost: '', telefon: '', villkor: null, anteckning: '' }; customers.push(c); }
        Object.assign(c, filled(k), { villkor: inv.villkor });
        inv.customerId = c.id;
      } else inv.customerId = null;
      inv.lines.forEach((l) => {
        if (!Calc.hasAmount(l) || !String(l.name || '').trim()) return;
        const key = fold(l.name).trim(); const prev = items.get(key);
        const price = inv.priceMode === 'inkl' ? Number(l.price) : Calc.r2(Number(l.price) * (1 + Number(l.vat) / 100));
        items.set(key, { id: prev ? prev.id : Calc.uid(), name: String(l.name).trim(), unit: l.unit || 'st', price, priceMode: 'inkl', vat: Number(l.vat), lastUsed: inv.datum || '' });
      });
    });
    out.invoices = used.map((p) => p.invoice).sort((a, b) => a.nr - b.nr);
    out.customers = customers; out.items = [...items.values()];
    out.maxNr = out.invoices.length ? Math.max(...out.invoices.map((i) => i.nr)) : null;
    return out;
  }
  async function readFiles(files) {
    const list = Array.from(files || []); const warnings = []; const parsed = [];
    if (!list.length) return combine([], ['Inga filer valdes.']);
    for (const f of list) {
      const name = (f && f.name) || 'Filen';
      if (/\.xls$/i.test(name)) { warnings.push(`${name}: är i det gamla Excel-formatet (.xls). Öppna filen i Excel, välj Spara som, Excel-arbetsbok (.xlsx), och läs in den nya filen.`); continue; }
      if (/\.(numbers|ods|csv|pdf|docx?|json|txt|png|jpe?g|heic)$/i.test(name)) { warnings.push(`${name}: är ingen Excel-fil (.xlsx) och hoppades över.`); continue; }
      try {
        const p = await parseXlsx(await readBuffer(f), name);
        warnings.push(...p.warnings);
        if (p.invoice) parsed.push(p);
      } catch (e) { warnings.push(e && e.message ? e.message : `${name}: kunde inte läsas.`); }
    }
    return combine(parsed, warnings);
  }

  const api = {
    base: '', readFiles, parseXlsx, parseSheet, readCells, sharedStrings, excelDate, textDate, pickRefs, splitPostOrt, combine, loadZip
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FakturaImport = api;
})(typeof self !== 'undefined' ? self : this);
