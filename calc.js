/* lil'bakery Faktura: belopp, moms, datum, numrering och status.
   Rena funktioner utan DOM. Används av appen (index.html), PDF:en (pdf.js), sync.js och testerna.
   I webbläsaren: window.FakturaCalc. I Node: require('./calc.js'). */
(function (root) {
  'use strict';

  // ---------- Tal ----------
  // Avrundar till öre, symmetriskt kring noll så att en kreditfaktura blir exakt originalets spegelbild.
  const r2 = (n) => { const x = Number(n) || 0; const s = x < 0 ? -1 : 1; return (s * Math.round((Math.abs(x) + Number.EPSILON) * 100) / 100) || 0; };
  const r0 = (n) => { const x = Number(n) || 0; const s = x < 0 ? -1 : 1; return (s * Math.round(Math.abs(x) + Number.EPSILON)) || 0; };
  const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
  // "1 234,50", "1234.5", "−3" och "12 kr" blir tal. Tom eller ogiltig text blir null.
  const parseNum = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v ?? '').replace(/[\s ]/g, '').replace(/kr$/i, '').replace(/−/g, '-').replace(',', '.');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return parseFloat(t);
  };
  const isNum = (v) => v !== '' && v != null && Number.isFinite(Number(v));
  const nf2 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfMax = (d) => new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const clean = (s) => s.replace(/−/g, '-');
  // 1700 -> "1 700,00". Mellanslaget är ett hårt mellanslag (U+00A0) som i svensk standard.
  const money = (n) => clean(nf2.format(r2(n)));
  const kr = (n) => money(n) + ' kr';
  // Antal och procent utan onödiga decimaler: 34 -> "34", 2.5 -> "2,5".
  const num = (n, maxDec = 2) => clean(nfMax(maxDec).format(Number(n) || 0));

  // ---------- Datum (alltid textformen ÅÅÅÅ-MM-DD) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const utc = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (s, n) => { if (!isYmd(s)) return ''; const d = new Date(utc(s) + Math.round(Number(n) || 0) * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const daysBetween = (a, b) => (isYmd(a) && isYmd(b) ? Math.round((utc(b) - utc(a)) / 86400000) : null);
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const longDate = (s) => { if (!isYmd(s)) return ''; const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

  // ---------- Moms ----------
  const VAT_RATES = [6, 12, 25, 0];
  // Matmomsen är tillfälligt 6 % (1 april 2026 till 31 december 2027). Efter slutdatumet föreslås momsEfter.
  function defaultVat(settings, dateYmd) {
    const s = settings || {};
    const base = Number.isFinite(Number(s.momsStandard)) ? Number(s.momsStandard) : 6;
    if (s.momsStandardTill && isYmd(dateYmd) && dateYmd > s.momsStandardTill) return Number.isFinite(Number(s.momsEfter)) ? Number(s.momsEfter) : 12;
    return base;
  }
  // Förslag på momsregistreringsnummer för enskild firma: SE + personnumrets tio siffror + 01.
  function suggestMomsregnr(orgnr) {
    let d = String(orgnr || '').replace(/\D/g, '');
    if (d.length === 12) d = d.slice(2);
    return d.length === 10 ? `SE${d}01` : '';
  }

  // ---------- Rader och summor ----------
  // En rad räknas om den har antal och pris. En rad med bara text skrivs ut som en kommentarsrad.
  // Pris 0 är tillåtet (till exempel en gratis provsmak), antal 0 är det inte.
  const hasAmount = (l) => !!l && isNum(l.qty) && isNum(l.price) && Number(l.qty) !== 0;
  const isTextLine = (l) => !!l && String(l.name || '').trim() !== '' && !hasAmount(l);
  const isEmptyLine = (l) => !l || (String(l.name || '').trim() === '' && !isNum(l.price));

  // priceMode 'inkl': priset per enhet är inklusive moms (som i Excel-mallens dolda kolumn S).
  // priceMode 'exkl': priset per enhet är exklusive moms.
  function lineCalc(line, priceMode) {
    const qty = Number(line && line.qty) || 0; const price = Number(line && line.price) || 0;
    const rate = Number(line && line.vat) || 0; const k = 1 + rate / 100;
    const text = isTextLine(line);
    if (priceMode === 'exkl') { const net = r2(qty * price); return { qty, rate, text, unitExkl: price, unitInkl: price * k, net, gross: r2(net * k) }; }
    const gross = r2(qty * price); return { qty, rate, text, unitExkl: price / k, unitInkl: price, net: r2(gross / k), gross };
  }

  // Summor per momssats. Ankaret är samma som i Excel-mallen och kassan:
  //  inkl: brutto per sats = summa av radernas brutto, netto = brutto / (1 + sats), moms = brutto - netto.
  //  exkl: netto per sats = summa av radernas netto, moms = netto * sats, brutto = netto + moms.
  // Radernas belopp exkl. moms (lines[i].net) kan skilja ett öre från satsens netto. Satsens värden gäller.
  // lines har samma index som invoice.lines.
  function totals(invoice) {
    const inv = invoice || {};
    const mode = inv.priceMode === 'exkl' ? 'exkl' : 'inkl';
    const lines = (inv.lines || []).map((l) => lineCalc(l, mode));
    const by = new Map();
    (inv.lines || []).forEach((l, i) => {
      if (!hasAmount(l)) return;
      const c = lines[i]; const g = by.get(c.rate) || { rate: c.rate, base: 0 };
      g.base += mode === 'exkl' ? c.net : c.gross; by.set(c.rate, g);
    });
    const rows = [...by.values()].sort((a, b) => b.rate - a.rate).map((g) => {
      if (mode === 'exkl') { const net = r2(g.base); const vat = r2(net * g.rate / 100); return { rate: g.rate, net, vat, gross: r2(net + vat) }; }
      const gross = r2(g.base); const net = r2(gross / (1 + g.rate / 100)); return { rate: g.rate, net, vat: r2(gross - net), gross };
    });
    const net = r2(sum(rows, (r) => r.net)); const vat = r2(sum(rows, (r) => r.vat)); const gross = r2(sum(rows, (r) => r.gross));
    const toPay = inv.oresavrundning ? r0(gross) : gross;
    return { mode, lines, rows, net, vat, gross, rounding: r2(toPay - gross), toPay: r2(toPay), count: (inv.lines || []).filter(hasAmount).length };
  }

  // ---------- Status ----------
  const STATUS_LABELS = { utkast: 'Utkast', klar: 'Ej skickad', skickad: 'Skickad', forfallen: 'Förfallen', betald: 'Betald', krediterad: 'Krediterad' };
  // Förfallen räknas fram: skickad eller ej skickad faktura vars förfallodag har passerats.
  function displayStatus(inv, t) {
    const day = t || today();
    if (inv.typ !== 'kredit' && (inv.status === 'klar' || inv.status === 'skickad') && isYmd(inv.forfallodag) && inv.forfallodag < day) return 'forfallen';
    return inv.status;
  }
  function statusLabel(inv, t) {
    const st = displayStatus(inv, t);
    if (inv.typ === 'kredit' && st === 'betald') return 'Reglerad';
    return STATUS_LABELS[st] || st;
  }
  const isFinal = (inv) => inv && inv.status !== 'utkast' && inv.nr != null;
  function title(inv) {
    if (!isFinal(inv)) return inv && inv.typ === 'kredit' ? 'Utkast till kreditfaktura' : 'Utkast';
    return `${inv.typ === 'kredit' ? 'Kreditfaktura' : 'Faktura'} ${inv.nr}`;
  }
  // Filnamn utan tecken som Windows inte tillåter.
  function filename(inv) {
    if (!isFinal(inv)) return 'faktura-utkast.pdf';
    return `${inv.typ === 'kredit' ? 'kreditfaktura' : 'faktura'}-${inv.nr}.pdf`;
  }

  // ---------- Numrering ----------
  // Fakturanummer delas ut när fakturan skapas (låses), aldrig för utkast, så att serien blir obruten.
  function nextNumber(state) {
    const used = (state.invoices || []).filter((i) => i.nr != null).map((i) => Number(i.nr));
    const start = Math.max(1, Math.floor(Number(state.settings && state.settings.nastaNummer) || 1));
    return Math.max(start, used.length ? Math.max(...used) + 1 : 1);
  }

  // ---------- Skapa och kopiera ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nowIso = () => new Date().toISOString();
  const CUSTOMER_FIELDS = ['namn', 'orgnr', 'adress', 'postnr', 'ort', 'land', 'kontakt', 'epost', 'telefon'];
  function customerSnapshot(c) { const o = {}; CUSTOMER_FIELDS.forEach((k) => { o[k] = (c && c[k]) || ''; }); return o; }
  const SELLER_FIELDS = ['foretag', 'namn', 'orgnr', 'momsregnr', 'adress', 'postnr', 'ort', 'telefon', 'epost', 'webb', 'plusgiro', 'bankgiro', 'swish', 'iban', 'bic', 'fskatt', 'drojsmalsranta', 'fakturaText'];
  function sellerSnapshot(settings) { const o = {}; SELLER_FIELDS.forEach((k) => { o[k] = settings && settings[k] != null ? settings[k] : ''; }); o.fskatt = !!(settings && settings.fskatt); return o; }
  function newLine(settings, dateYmd, init) {
    return Object.assign({ id: uid(), name: '', qty: 1, unit: 'st', price: null, vat: defaultVat(settings, dateYmd) }, init || {});
  }
  function blankInvoice(settings, customer, t) {
    const s = settings || {}; const day = t || today();
    const villkor = customer && Number.isFinite(Number(customer.villkor)) && customer.villkor !== '' && customer.villkor != null ? Number(customer.villkor) : (Number(s.betalningsvillkor) || 30);
    const ts = nowIso();
    return {
      id: uid(), typ: 'faktura', status: 'utkast', nr: null,
      customerId: customer ? customer.id : null, kund: customerSnapshot(customer), saljare: null,
      datum: day, leveransdatum: day, villkor, forfallodag: addDays(day, villkor),
      varRef: s.namn || '', erRef: (customer && customer.kontakt) || '', markning: '',
      priceMode: s.prisLage === 'exkl' ? 'exkl' : 'inkl', oresavrundning: !!s.oresavrundning,
      lines: [newLine(s, day)], meddelande: '',
      krediterar: null, krediteradAv: null, totals: null,
      created: ts, updated: ts, finalizedAt: null, sentAt: null, paidAt: null, history: []
    };
  }
  // Ny faktura med samma kund och rader som en tidigare, med dagens datum.
  function copyInvoice(src, settings, t) {
    const day = t || today(); const inv = blankInvoice(settings, null, day);
    Object.assign(inv, {
      customerId: src.customerId, kund: Object.assign({}, src.kund), villkor: src.villkor, forfallodag: addDays(day, src.villkor),
      erRef: src.erRef || '', markning: src.markning || '', priceMode: src.priceMode, oresavrundning: !!src.oresavrundning, meddelande: src.meddelande || '',
      lines: (src.lines || []).map((l) => Object.assign({}, l, { id: uid(), qty: Math.abs(Number(l.qty)) || l.qty }))
    });
    if (src.typ === 'kredit') inv.typ = 'faktura';
    return inv;
  }
  // Utkast till kreditfaktura som tar bort hela originalet: samma rader med negativt antal.
  function creditFor(src, settings, t) {
    const day = t || today(); const inv = blankInvoice(settings, null, day);
    Object.assign(inv, {
      typ: 'kredit', customerId: src.customerId, kund: Object.assign({}, src.kund), villkor: 0, forfallodag: day,
      leveransdatum: src.leveransdatum || '', varRef: src.varRef || inv.varRef, erRef: src.erRef || '', markning: src.markning || '',
      priceMode: src.priceMode, oresavrundning: !!src.oresavrundning,
      meddelande: `Kreditering av faktura ${src.nr}.`,
      krediterar: { id: src.id, nr: src.nr, datum: src.datum },
      lines: (src.lines || []).map((l) => Object.assign({}, l, { id: uid(), qty: hasAmount(l) ? -Number(l.qty) : l.qty }))
    });
    return inv;
  }

  // ---------- Kontroll före låsning ----------
  // errors stoppar låsningen. warnings visas men går att bekräfta bort.
  function validate(inv, seller) {
    const errors = []; const warnings = []; const k = inv.kund || {}; const s = seller || {};
    if (!String(k.namn || '').trim()) errors.push('Kunden saknar namn.');
    if (!String(k.adress || '').trim() && !String(k.ort || '').trim()) errors.push('Kunden saknar adress.');
    if (!isYmd(inv.datum)) errors.push('Fakturadatum saknas.');
    if (!(inv.lines || []).some(hasAmount)) errors.push('Fakturan har inga rader med antal och pris.');
    (inv.lines || []).forEach((l, i) => { if (!isEmptyLine(l) && !String(l.name || '').trim()) errors.push(`Rad ${i + 1} saknar benämning.`); });
    if (!String(s.foretag || '').trim()) errors.push('Ditt företagsnamn saknas under Inställningar.');
    if (!String(s.orgnr || '').trim()) errors.push('Ditt organisationsnummer saknas under Inställningar.');
    if (!String(s.adress || '').trim()) errors.push('Din adress saknas under Inställningar.');
    const t = totals(inv);
    if (t.vat !== 0 && !String(s.momsregnr || '').trim()) errors.push('Momsregistreringsnummer saknas under Inställningar. Det måste stå på en faktura med moms.');
    if (!String(s.plusgiro || s.bankgiro || s.swish || s.iban || '').trim()) warnings.push('Inga betalningsuppgifter (plusgiro, bankgiro eller Swish) finns under Inställningar.');
    if (!isYmd(inv.leveransdatum)) warnings.push('Leveransdatum saknas.');
    if (inv.typ !== 'kredit' && t.toPay <= 0) warnings.push('Att betala är 0 kr eller mindre.');
    if (!String(k.epost || '').trim()) warnings.push('Kunden saknar e-postadress, så fakturan kan inte mejlas direkt.');
    return { errors: [...new Set(errors)], warnings };
  }

  const api = {
    VAT_RATES, STATUS_LABELS, CUSTOMER_FIELDS, SELLER_FIELDS,
    r2, r0, sum, parseNum, isNum, money, kr, num,
    today, isYmd, addDays, daysBetween, longDate,
    defaultVat, suggestMomsregnr,
    hasAmount, isTextLine, isEmptyLine, lineCalc, totals,
    displayStatus, statusLabel, isFinal, title, filename,
    nextNumber, uid, customerSnapshot, sellerSnapshot, newLine, blankInvoice, copyInvoice, creditFor, validate
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FakturaCalc = api;
})(typeof self !== 'undefined' ? self : this);
