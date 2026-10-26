// Tester för import.js: läser gamla fakturor från Excel-mallen.
// Den riktiga filen (Resources/Faktura 106.xlsx) innehåller verkliga uppgifter. Testerna kontrollerar därför
// bara struktur och samband, aldrig namn eller nummer. De påhittade filerna byggs här med JSZip.
// Kör: node --test faktura/tests/import.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Imp = require('../import.js');
const Calc = require('../calc.js');
const JSZip = require('../vendor/jszip.min.js');

const REAL = process.env.FAKTURA_XLSX || fileURLToPath(new URL('../Resources/Faktura 106.xlsx', import.meta.url));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nameTokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
const localPart = (email) => fold(String(email).split('@')[0]);
const matchesEmail = (name, email) => nameTokens(name).some((t) => localPart(email).includes(t));

// ---------- Den riktiga Excel-fakturan ----------
test('riktiga Excel-fakturan: nummer, datum, villkor och rad', { skip: !existsSync(REAL) && 'Resources/Faktura 106.xlsx saknas' }, async () => {
  const r = await Imp.readFiles([new File([readFileSync(REAL)], 'Faktura 106.xlsx')]);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.invoices.length, 1);
  const inv = r.invoices[0];
  assert.equal(inv.file, 'Faktura 106.xlsx');
  assert.equal(inv.nr, 106);
  assert.equal(r.maxNr, 106);
  assert.equal(inv.datum, '2026-05-05');
  assert.equal(inv.leveransdatum, '2026-05-06');
  assert.equal(inv.villkor, 14);
  assert.equal(inv.forfallodag, '2026-05-19');
  assert.equal(inv.priceMode, 'inkl');
  assert.equal(inv.typ, 'faktura');
  assert.equal(inv.lines.length, 1);
  const [l] = inv.lines;
  assert.equal(l.qty, 34); assert.equal(l.unit, 'st'); assert.equal(l.price, 50); assert.equal(l.vat, 6);
  assert.ok(l.name.length > 0 && typeof l.id === 'string');
  const t = Calc.totals(inv);
  assert.equal(t.toPay, 1700); assert.equal(t.net, 1603.77); assert.equal(t.vat, 96.23);
  assert.deepEqual(r.items.map((i) => [i.price, i.priceMode, i.vat, i.unit, i.lastUsed]), [[50, 'inkl', 6, 'st', '2026-05-05']]);
  assert.equal(r.items[0].name, l.name);
});

test('riktiga Excel-fakturan: omkastade referenser, kund och säljare', { skip: !existsSync(REAL) && 'Resources/Faktura 106.xlsx saknas' }, async () => {
  const r = await Imp.readFiles([new File([readFileSync(REAL)], 'Faktura 106.xlsx')]);
  const inv = r.invoices[0]; const s = r.seller;
  assert.equal(r.customers.length, 1);
  const c = r.customers[0];
  // Er referens är den som stämmer med kundens e-post, Vår referens den som stämmer med säljarens.
  assert.ok(inv.erRef && inv.varRef && inv.erRef !== inv.varRef);
  assert.match(c.epost, EMAIL);
  assert.ok(matchesEmail(inv.erRef, c.epost), 'Er referens ska stämma med kundens e-post');
  assert.ok(!matchesEmail(inv.varRef, c.epost), 'Vår referens ska inte stämma med kundens e-post');
  assert.ok(matchesEmail(inv.varRef, s.epost), 'Vår referens ska stämma med säljarens e-post');
  assert.equal(c.kontakt, inv.erRef);
  assert.equal(inv.kund.kontakt, inv.erRef);
  assert.equal(s.namn, inv.varRef);
  assert.equal(inv.customerId, c.id);
  // Kunden
  assert.ok(c.namn.length > 0);
  assert.match(c.orgnr, /^\d{6}-\d{4}$/);
  assert.ok(c.adress.length > 0);
  assert.match(c.postnr, /^\d{3} \d{2}$/);
  assert.ok(c.ort.length > 0 && !/\d/.test(c.ort));
  assert.equal(c.villkor, 14);
  assert.deepEqual(inv.kund, Object.fromEntries(Calc.CUSTOMER_FIELDS.map((k) => [k, c[k]])));
  // Säljaren från sidfoten: prefixen Tel: och Mail: borttagna.
  assert.ok(s.foretag.length > 0);
  assert.ok(s.adress.length > 0);
  assert.match(s.postnr, /^\d{3} \d{2}$/);
  assert.match(s.telefon, /^[+\d][\d -]+$/);
  assert.doesNotMatch(s.telefon, /^\s|\s$|tel/i);
  assert.match(s.epost, EMAIL);
  assert.doesNotMatch(s.epost, /mail:/i);
  assert.match(s.orgnr, /^\d{6}-\d{4}$/);
  assert.match(s.plusgiro, /^\d+-\d$/);
  assert.equal(s.bankgiro, undefined);
  assert.equal(s.fskatt, true);
  assert.notEqual(s.orgnr, c.orgnr);
});

// ---------- Påhittade filer i mallens format ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const serial = (ymd, date1904) => { const [y, m, d] = ymd.split('-').map(Number); return (Date.UTC(y, m - 1, d) - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 86400000; };
// cells: { A1: värde }. Tal blir tal, text blir delad sträng. { inline }, { rich: [...] }, { str, f }, { f, v } för andra typer.
async function makeXlsx(cells, { date1904 = false, prefix = '', sheetName = 'Laskupohja' } = {}) {
  const p = prefix ? prefix + ':' : ''; const ns = prefix ? `xmlns:${prefix}` : 'xmlns';
  const sst = []; const rows = new Map();
  for (const [ref, val] of Object.entries(cells)) {
    const [, col, row] = /^([A-Z]+)(\d+)$/.exec(ref);
    let xml;
    if (typeof val === 'number') xml = `<${p}c r="${ref}" s="3"><${p}v>${val}</${p}v></${p}c>`;
    else if (typeof val === 'string') { sst.push(`<${p}si><${p}t xml:space="preserve">${esc(val)}</${p}t></${p}si>`); xml = `<${p}c r="${ref}" t="s"><${p}v>${sst.length - 1}</${p}v></${p}c>`; }
    else if (val.rich) { sst.push(`<${p}si>${val.rich.map((t, i) => `<${p}r><${p}rPr><${p}b/></${p}rPr><${p}t xml:space="preserve">${esc(t)}</${p}t></${p}r>`).join('')}<${p}rPh sb="0" eb="1"><${p}t>FONETISK</${p}t></${p}rPh></${p}si>`); xml = `<${p}c r="${ref}" t="s"><${p}v>${sst.length - 1}</${p}v></${p}c>`; }
    else if (val.inline != null) xml = `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${esc(val.inline)}</${p}t></${p}is></${p}c>`;
    else if (val.str != null) xml = `<${p}c r="${ref}" t="str"><${p}f>${esc(val.f || 'A1')}</${p}f><${p}v>${esc(val.str)}</${p}v></${p}c>`;
    else if (val.f != null) xml = `<${p}c r="${ref}"><${p}f>${esc(val.f)}</${p}f><${p}v>${val.v}</${p}v></${p}c>`;
    else if (val.err) xml = `<${p}c r="${ref}" t="e"><${p}v>#DIV/0!</${p}v></${p}c>`;
    if (!rows.has(Number(row))) rows.set(Number(row), []);
    rows.get(Number(row)).push({ col, xml });
  }
  const sheetData = [...rows.keys()].sort((a, b) => a - b).map((r) => `<${p}row r="${r}">${rows.get(r).map((c) => c.xml).join('')}</${p}row>`).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><${p}workbook ${ns}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${p}workbookPr${date1904 ? ' date1904="1"' : ''}/><${p}sheets><${p}sheet name="${sheetName}" sheetId="1" r:id="rId7"/></${p}sheets></${p}workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/blad1.xml"/></Relationships>');
  zip.file('xl/worksheets/blad1.xml', `<?xml version="1.0"?><${p}worksheet ${ns}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${p}cols><${p}col min="1" max="1" width="2"/></${p}cols><${p}sheetData>${sheetData}</${p}sheetData></${p}worksheet>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><${p}sst ${ns}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}">${sst.join('')}</${p}sst>`);
  return zip.generateAsync({ type: 'uint8array' });
}
// Mallens fasta delar med påhittade uppgifter.
function template(o) {
  const c = {
    E3: 'Testbageriet', J3: o.title || 'FAKTURA', J4: 'Fakturanummer', L4: o.nr, J5: 'Datum', L5: serial(o.datum, o.date1904), J6: 'Förfallodag',
    C9: 'Leveransdatum', C10: 'Betalningsvillkor', E10: o.villkor ?? '30 dagar netto',
    C11: 'Vår referens', E11: o.e11, C12: 'Er referens', E12: o.e12, C13: 'Märkning', E13: '-',
    J9: o.kund || 'Exempelbolaget AB', J10: o.orgnr ?? 5566778899, J11: 'Provgatan 2', J12: '41301 Göteborg', J13: 'eva.exempel@example.se',
    C19: 'Namn', H19: 'Mängd', J19: 'à-pris kr', K19: 'Moms', L19: 'Totalt kr',
    J24: { str: '', f: 'IF(S24=0,"",S24/(1+K24))' }, L24: { str: '', f: 'IF(S24="","",H24*J24)' }, J25: { err: true },
    L51: o.payLabel || 'Bankgiro', L52: '123-4567', C53: 'Testbageriet', E53: '                  Tel: 070-000 00 00', J53: 'Organisationsnummer', L53: '850101-1234',
    C54: 'Bagargatan 1', E54: '                   Mail: anna.bagare@example.se', J54: 'Godkänd för F-skatt', C55: '123 45 Stockholm'
  };
  if (o.leverans) c.E9 = o.leverans;
  return Object.assign(c, o.cells || {});
}

test('påhittad fil: priser exklusive moms, rich text, inline-text, formelresultat och textdatum', async () => {
  const cells = template({
    nr: 41, datum: '2025-03-03', leverans: '2025-03-04', e11: 'Anna Bagare', e12: 'Eva Exempel',
    cells: {
      C20: { rich: ['Tiramisu ', 'Cupcakes'] }, H20: 10, I20: 'st', J20: 40, K20: 0.06, L20: { f: 'H20*J20', v: 400 },
      C21: { inline: 'Leverans & uppbärning' }, H21: 1, I21: { str: 'st', f: '"st"' }, J21: { f: '50+50', v: 100 }, K21: 0.25,
      C22: 'Ring vid ankomst',
      L46: { f: 'L44+L45', v: 549 }
    }
  });
  const r = await Imp.readFiles([new File([await makeXlsx(cells)], 'faktura 41.xlsx')]);
  assert.deepEqual(r.warnings, []);
  const inv = r.invoices[0];
  assert.equal(inv.nr, 41);
  assert.equal(inv.datum, '2025-03-03');
  assert.equal(inv.leveransdatum, '2025-03-04');
  assert.equal(inv.villkor, 30);
  assert.equal(inv.forfallodag, '2025-04-02');
  assert.equal(inv.priceMode, 'exkl');
  assert.deepEqual(inv.lines.map(({ name, qty, unit, price, vat }) => ({ name, qty, unit, price, vat })), [
    { name: 'Tiramisu Cupcakes', qty: 10, unit: 'st', price: 40, vat: 6 },
    { name: 'Leverans & uppbärning', qty: 1, unit: 'st', price: 100, vat: 25 },
    { name: 'Ring vid ankomst', qty: '', unit: '', price: null, vat: 0 }
  ]);
  assert.ok(Calc.isTextLine(inv.lines[2]));
  assert.equal(Calc.totals(inv).toPay, 549);
  // Referenserna står i rätt ordning här.
  assert.equal(inv.varRef, 'Anna Bagare'); assert.equal(inv.erRef, 'Eva Exempel');
  assert.deepEqual(inv.kund, { namn: 'Exempelbolaget AB', orgnr: '556677-8899', adress: 'Provgatan 2', postnr: '413 01', ort: 'Göteborg', land: '', kontakt: 'Eva Exempel', epost: 'eva.exempel@example.se', telefon: '' });
  assert.deepEqual(r.seller, { foretag: 'Testbageriet', adress: 'Bagargatan 1', postnr: '123 45', ort: 'Stockholm', telefon: '070-000 00 00', epost: 'anna.bagare@example.se', orgnr: '850101-1234', bankgiro: '123-4567', fskatt: true, namn: 'Anna Bagare' });
  // Artiklar sparas med pris inklusive moms.
  assert.deepEqual(r.items.map(({ name, price, priceMode, vat }) => ({ name, price, priceMode, vat })), [
    { name: 'Tiramisu Cupcakes', price: 42.4, priceMode: 'inkl', vat: 6 },
    { name: 'Leverans & uppbärning', price: 125, priceMode: 'inkl', vat: 25 }
  ]);
});

test('flera filer: kunder unika på orgnr, artiklar unika på namn, senaste fakturan vinner', async () => {
  const a = template({ nr: 41, datum: '2025-03-03', e11: 'Anna Bagare', e12: 'Eva Exempel', cells: { C20: 'Tiramisu Cupcakes', H20: 10, I20: 'st', S20: 50, K20: 0.06, J20: { f: 'S20/(1+K20)', v: 47.16981132 } } });
  // Senare faktura i 1904-systemet, med namnrymdsprefix, omkastade referenser och kundnamnet i versaler.
  const b = template({
    nr: 43, datum: '2025-04-01', date1904: true, e11: 'Eva Exempel', e12: 'Anna Bagare', kund: 'EXEMPELBOLAGET AB', orgnr: '556677-8899', villkor: '10 dgr netto', payLabel: 'Plusgiro',
    cells: { C20: 'tiramisu cupcakes', H20: 20, I20: 'st', S20: 45, K20: 0.06, C21: 'Brownie', H21: 5, I21: 'st', S21: 30, K21: 0.06 }
  });
  // Annan kund utan orgnr: matchas på namn.
  const c = template({ nr: 42, datum: '2025-03-20', e11: 'Anna Bagare', e12: 'Per Persson', kund: 'Per Persson', orgnr: '', cells: { J10: 'Storgatan 100', J11: '111 22 Stockholm', J12: '', J13: 'per@example.se', C20: 'Brownie', H20: 2, I20: 'st', S20: 25, K20: 0.06 } });
  const files = [
    new File([await makeXlsx(b, { date1904: true, prefix: 'x' })], 'b.xlsx'),
    new File([await makeXlsx(a)], 'a.xlsx'),
    new File([await makeXlsx(c)], 'c.xlsx')
  ];
  const r = await Imp.readFiles(files);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.invoices.map((i) => i.nr), [41, 42, 43]);
  assert.equal(r.maxNr, 43);
  const inv43 = r.invoices.find((i) => i.nr === 43);
  assert.equal(inv43.datum, '2025-04-01');
  assert.equal(inv43.erRef, 'Eva Exempel');   // omkastad i filen, rättad via e-posten
  assert.equal(inv43.varRef, 'Anna Bagare');
  assert.equal(inv43.villkor, 10);
  assert.equal(r.customers.length, 2);
  const ex = r.customers.find((k) => k.orgnr === '556677-8899');
  assert.equal(ex.namn, 'EXEMPELBOLAGET AB');   // senaste fakturan vinner
  assert.equal(ex.villkor, 10);
  assert.equal(ex.kontakt, 'Eva Exempel');
  assert.equal(r.invoices.find((i) => i.nr === 41).customerId, ex.id);
  assert.equal(inv43.customerId, ex.id);
  const per = r.customers.find((k) => k.namn === 'Per Persson');
  assert.deepEqual([per.orgnr, per.adress, per.postnr, per.ort], ['', 'Storgatan 100', '111 22', 'Stockholm']);
  assert.equal(r.items.length, 2);
  const tira = r.items.find((i) => fold(i.name) === 'tiramisu cupcakes');
  assert.deepEqual([tira.name, tira.price, tira.lastUsed], ['tiramisu cupcakes', 45, '2025-04-01']);
  const brownie = r.items.find((i) => i.name === 'Brownie');
  assert.deepEqual([brownie.price, brownie.lastUsed], [30, '2025-04-01']);
  assert.equal(r.seller.plusgiro, '123-4567');   // från senaste filen
  assert.equal(r.seller.bankgiro, '123-4567');   // äldre filer fyller i det som saknas
});

test('varningar: fel format, inte mallen, trasig fil, dubbla nummer och saknad moms', async () => {
  const notTemplate = await makeXlsx({ A1: 'Kundlista', B2: 'Namn', C2: 'Telefon' });
  const ok = template({ nr: 50, datum: '2025-06-01', e11: 'Anna Bagare', e12: 'Eva Exempel', cells: { C20: 'Bulle', H20: 3, I20: 'st', S20: 20, K20: 0.06, C21: 'Kaffe', H21: 1, I21: 'st', S21: 30, L46: 95 } });
  const dup = template({ nr: 50, datum: '2025-06-02', e11: 'Anna Bagare', e12: 'Eva Exempel', villkor: '', cells: { C20: 'Bulle', H20: 1, I20: 'st', S20: 20, K20: 0.06, L6: serial('2025-06-12') } });
  const r = await Imp.readFiles([
    new File(['gammalt'], 'Faktura 12.xls'),
    new File(['inte en zip'], 'trasig.xlsx'),
    new File(['%PDF'], 'Faktura 13.pdf'),
    new File([notTemplate], 'kunder.xlsx'),
    new File([await makeXlsx(ok)], 'Faktura 50.xlsx'),
    new File([await makeXlsx(dup)], 'Faktura 50 kopia.xlsx')
  ]);
  const w = r.warnings.join('\n');
  assert.match(w, /Faktura 12\.xls: .*\.xls.*Spara som/);
  assert.match(w, /trasig\.xlsx: kunde inte öppnas som Excel-fil/);
  assert.match(w, /Faktura 13\.pdf: är ingen Excel-fil/);
  assert.match(w, /kunder\.xlsx: hittar inget fakturanummer i cell L4/);
  assert.match(w, /Faktura 50\.xlsx, rad 21: momssats saknas/);
  assert.match(w, /Faktura 50\.xlsx: summan i filen/);   // 95 kr i filen, raderna ger 90 kr
  assert.match(w, /Fakturanummer 50 finns i flera filer/);
  assert.equal(r.invoices.length, 1);
  assert.equal(r.invoices[0].file, 'Faktura 50 kopia.xlsx');   // den senare vinner
  assert.equal(r.invoices[0].villkor, 10);   // villkoret räknas fram från förfallodagen i L6
  assert.ok(r.warnings.every((x) => typeof x === 'string' && x.length > 10));
  const empty = await Imp.readFiles([]);
  assert.deepEqual([empty.invoices, empty.customers, empty.items, empty.maxNr], [[], [], [], null]);
  assert.match(empty.warnings[0], /Inga filer/);
});

// ---------- Små delar ----------
test('excelDate: 1900- och 1904-systemet, textdatum', () => {
  assert.equal(Imp.excelDate(46147), '2026-05-05');
  assert.equal(Imp.excelDate(46148.75), '2026-05-06');
  assert.equal(Imp.excelDate(serial('2027-12-31')), '2027-12-31');
  assert.equal(Imp.excelDate(serial('2026-05-05', true), true), '2026-05-05');
  assert.equal(Imp.excelDate(0), '');
  assert.equal(Imp.excelDate('x'), '');
  assert.equal(Imp.textDate('2026-05-05'), '2026-05-05');
  assert.equal(Imp.textDate('5.5.2026'), '2026-05-05');
  assert.equal(Imp.textDate('20260505'), '2026-05-05');
  assert.equal(Imp.textDate('31.2.2026'), '');
  assert.equal(Imp.textDate('i morgon'), '');
});

test('pickRefs: e-posten avgör, annars etiketterna', () => {
  const swapped = Imp.pickRefs('Eva Exempel', 'Anna Bagare', 'Vår referens', 'Er referens', 'eva.exempel@example.se', 'anna@example.se');
  assert.deepEqual(swapped, { erRef: 'Eva Exempel', varRef: 'Anna Bagare' });
  const bySeller = Imp.pickRefs('Anna Bagare', 'Inköp', 'Vår referens', 'Er referens', 'faktura@example.se', 'anna.bagare@example.se');
  assert.deepEqual(bySeller, { erRef: 'Inköp', varRef: 'Anna Bagare' });
  const byLabel = Imp.pickRefs('Per', 'Eva', 'Er referens', 'Vår referens', '', '');
  assert.deepEqual(byLabel, { erRef: 'Per', varRef: 'Eva' });
  const accents = Imp.pickRefs('Anna Bagare', 'Émile Öberg', 'Vår referens', 'Er referens', 'emile.oberg@example.se', '');
  assert.equal(accents.erRef, 'Émile Öberg');
});

test('readCells: delade strängar, tecken som &amp; och _x000D_, celler utan r-attribut', () => {
  const sst = Imp.sharedStrings('<sst><si><t>A &amp; B</t></si><si><r><t>Ra</t></r><r><t xml:space="preserve">d 2</t></r></si><si><t>x_x000D_y</t></si><si/></sst>');
  assert.deepEqual(sst, ['A & B', 'Rad 2', 'x\ry', '']);
  const cells = Imp.readCells('<worksheet><sheetData><row r="3"><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c r="E3" t="b"><v>1</v></c></row><row><c><v>7.5</v></c></row></sheetData></worksheet>', sst);
  assert.deepEqual(cells, { A3: { v: 'A & B', t: 's' }, B3: { v: 'Rad 2', t: 's' }, E3: { v: true, t: 'b' }, A4: { v: 7.5, t: 'n' } });
  assert.deepEqual(Imp.splitPostOrt('SE-413 01 Göteborg'), { postnr: '413 01', ort: 'Göteborg' });
  assert.deepEqual(Imp.splitPostOrt('Göteborg'), { postnr: '', ort: 'Göteborg' });
});

test('inga personuppgifter i källkoden: inga e-postadresser eller telefonnummer i appens filer', () => {
  for (const f of ['../sync.js', '../import.js', '../sw.js', '../README.md']) {
    const url = new URL(f, import.meta.url); if (!existsSync(url)) continue;
    const src = readFileSync(url, 'utf8');
    const emails = (src.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).filter((e) => !/example\.(se|com)$|exempel\.se$/.test(e));
    assert.deepEqual(emails, [], `${f} innehåller e-postadresser`);
    assert.doesNotMatch(src, /\b07\d[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/, `${f} innehåller ett mobilnummer`);
  }
});
