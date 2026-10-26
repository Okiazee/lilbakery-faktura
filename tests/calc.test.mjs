// Tester för calc.js. Kör: node --test tests/
process.env.TZ = 'Europe/Stockholm';   // sommartid/vintertid ska inte påverka datumräkningen
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../calc.js');
const fixture = require('./fixture.js');
const NB = '\u00A0';
const fx = () => fixture();
const byId = (f, id) => f.invoices.find((i) => i.id === id);
// Jämför summor fält för fält (inte lines, som har flyttal med fler decimaler).
const sums = (t) => ({ rows: t.rows, net: t.net, vat: t.vat, gross: t.gross, rounding: t.rounding, toPay: t.toPay });
const neg = (t) => ({
  rows: t.rows.map((r) => ({ rate: r.rate, net: -r.net || 0, vat: -r.vat || 0, gross: -r.gross || 0 })),
  net: -t.net || 0, vat: -t.vat || 0, gross: -t.gross || 0, rounding: -t.rounding || 0, toPay: -t.toPay || 0
});

describe('fixture och Excel-fakturan', () => {
  test('f107 = Excel 106: 34 st à 50 kr inkl. 6 % ger 1 603,77 + 96,23 = 1 700,00', () => {
    const f = fx(); const t = C.totals(byId(f, 'f107'));
    assert.deepEqual(sums(t), Object.assign({ rounding: 0 }, f.expected.f107));
    assert.equal(t.count, 1);
    assert.equal(t.mode, 'inkl');
    assert.equal(C.r2(t.lines[0].unitExkl), 47.17);
    assert.equal(t.lines[0].net, 1603.77);
    assert.equal(t.lines[0].gross, 1700);
    assert.equal(C.r2(t.net + t.vat), t.gross);
  });
  test('kreditfakturan k109 är exakt spegelbilden av f107', () => {
    const f = fx();
    assert.deepEqual(sums(C.totals(byId(f, 'k109'))), neg(C.totals(byId(f, 'f107'))));
  });
  test('f108: två momssatser, exkl. moms och öresavrundning', () => {
    const t = C.totals(byId(fx(), 'f108'));
    assert.deepEqual(t.rows, [{ rate: 25, net: 3125, vat: 781.25, gross: 3906.25 }, { rate: 6, net: 20635.2, vat: 1238.11, gross: 21873.31 }]);
    assert.equal(t.net, 23760.2); assert.equal(t.vat, 2019.36); assert.equal(t.gross, 25779.56);
    assert.equal(t.rounding, 0.44); assert.equal(t.toPay, 25780);
    assert.equal(t.count, 34);   // 35 rader, varav en textrad
  });
  test('utkastet d1 räknar inte den tomma raden', () => {
    const t = C.totals(byId(fx(), 'd1'));
    assert.equal(t.count, 1); assert.equal(t.gross, 700); assert.equal(t.toPay, 700);
  });
});

describe('kreditering', () => {
  for (const id of ['f107', 'f108']) {
    test(`creditFor(${id}) ger exakt negativa summor, även avrundningen`, () => {
      const f = fx(); const src = byId(f, id);
      const cr = C.creditFor(src, f.settings, '2026-07-01');
      assert.deepEqual(sums(C.totals(cr)), neg(C.totals(src)));
    });
  }
  test('symmetrisk avrundning kring noll', () => {
    for (const x of [1.005, 0.125, 2.675, 1603.765, 0.5]) {
      assert.ok(C.r2(-x) === -C.r2(x), `r2 ${x}`); assert.ok(C.r0(-x) === -C.r0(x), `r0 ${x}`);
    }
    assert.ok(Object.is(C.r2(-0.001), 0), 'inget minus noll');
  });
});

describe('räkning per läge', () => {
  test('exkl: netto per sats summeras först, sedan moms på summan', () => {
    const inv = { priceMode: 'exkl', lines: [{ qty: 3, price: 33.33, vat: 25 }, { qty: 1, price: 0.01, vat: 25 }, { qty: 2.5, price: 450, vat: 25 }] };
    const t = C.totals(inv);
    assert.equal(t.lines[0].net, 99.99); assert.equal(t.lines[0].unitExkl, 33.33);
    assert.equal(t.lines[2].net, 1125);
    assert.deepEqual(t.rows, [{ rate: 25, net: 1225, vat: 306.25, gross: 1531.25 }]);
  });
  test('inkl: brutto per sats summeras först, netto = brutto / (1 + sats)', () => {
    const inv = { priceMode: 'inkl', lines: [{ qty: 1, price: 10, vat: 6 }, { qty: 1, price: 10, vat: 6 }, { qty: 1, price: 10, vat: 6 }] };
    const t = C.totals(inv);
    assert.deepEqual(t.rows, [{ rate: 6, net: 28.3, vat: 1.7, gross: 30 }]);
    assert.equal(t.lines[0].net, 9.43);   // radens netto kan skilja ett öre från satsens
  });
  test('saknat priceMode räknas som inkl', () => {
    assert.equal(C.totals({ lines: [{ qty: 1, price: 106, vat: 6 }] }).net, 100);
  });
  test('öresavrundning upp, ned och av', () => {
    const mk = (price, on) => ({ priceMode: 'inkl', oresavrundning: on, lines: [{ qty: 1, price, vat: 6 }] });
    assert.deepEqual([C.totals(mk(100.49, true)).toPay, C.totals(mk(100.49, true)).rounding], [100, -0.49]);
    assert.deepEqual([C.totals(mk(100.5, true)).toPay, C.totals(mk(100.5, true)).rounding], [101, 0.5]);
    assert.deepEqual([C.totals(mk(100.49, false)).toPay, C.totals(mk(100.49, false)).rounding], [100.49, 0]);
  });
  test('flera momssatser sorteras fallande och summeras', () => {
    const t = C.totals({ priceMode: 'exkl', lines: [{ qty: 1, price: 100, vat: 0 }, { qty: 1, price: 100, vat: 6 }, { qty: 1, price: 100, vat: 25 }, { qty: 1, price: 100, vat: 12 }] });
    assert.deepEqual(t.rows.map((r) => r.rate), [25, 12, 6, 0]);
    assert.equal(t.net, 400); assert.equal(t.vat, 43); assert.equal(t.gross, 443);
    assert.equal(t.rows.find((r) => r.rate === 0).vat, 0);
  });
});

describe('textrader, tomma rader och pris 0', () => {
  const text = { name: 'Leverans fredag', qty: '', unit: '', price: null, vat: 6 };
  const empty = { name: '', qty: 1, unit: 'st', price: null, vat: 6 };
  const free = { name: 'Provsmak', qty: 10, unit: 'st', price: 0, vat: 6 };
  const zeroQty = { name: 'Inget', qty: 0, unit: 'st', price: 50, vat: 6 };
  test('klassning', () => {
    assert.equal(C.isTextLine(text), true); assert.equal(C.hasAmount(text), false); assert.equal(C.isEmptyLine(text), false);
    assert.equal(C.isEmptyLine(empty), true); assert.equal(C.isTextLine(empty), false);
    assert.equal(C.hasAmount(free), true); assert.equal(C.isTextLine(free), false);
    assert.equal(C.hasAmount(zeroQty), false); assert.equal(C.isTextLine(zeroQty), true);
    assert.equal(C.isEmptyLine(null), true);
  });
  test('bara rader med belopp räknas, index följer invoice.lines', () => {
    const t = C.totals({ priceMode: 'exkl', lines: [text, { name: 'Bulle', qty: 2, price: 10, vat: 6 }, empty, free, zeroQty] });
    assert.equal(t.count, 2); assert.equal(t.lines.length, 5);
    assert.equal(t.lines[0].text, true); assert.equal(t.lines[1].net, 20); assert.equal(t.lines[3].net, 0);
    assert.deepEqual(t.rows, [{ rate: 6, net: 20, vat: 1.2, gross: 21.2 }]);
  });
  test('tal som text fungerar', () => {
    assert.equal(C.totals({ priceMode: 'inkl', lines: [{ qty: '34', price: '50', vat: '6' }] }).gross, 1700);
  });
});

describe('datum', () => {
  test('addDays över sommartid och vintertid', () => {
    assert.equal(C.addDays('2026-03-28', 2), '2026-03-30');
    assert.equal(C.addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(C.addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(C.addDays('2026-10-25', 14), '2026-11-08');
  });
  test('addDays över månads- och årsskiften', () => {
    assert.equal(C.addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(C.addDays('2026-02-28', 1), '2026-03-01');
    assert.equal(C.addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(C.addDays('2026-12-20', 14), '2027-01-03');
    assert.equal(C.addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(C.addDays('2026-05-05', 0), '2026-05-05');
    assert.equal(C.addDays('2026-05-05', '14'), '2026-05-19');
  });
  test('addDays och daysBetween med ogiltigt datum', () => {
    assert.equal(C.addDays('', 14), ''); assert.equal(C.addDays('5/5/2026', 1), '');
    assert.equal(C.daysBetween('2026-03-28', '2026-03-30'), 2);
    assert.equal(C.daysBetween('2026-12-31', '2027-01-01'), 1);
    assert.equal(C.daysBetween('', '2027-01-01'), null);
  });
  test('longDate', () => {
    assert.equal(C.longDate('2026-05-05'), '5 maj 2026');
    assert.equal(C.longDate('2026-12-31'), '31 december 2026');
    assert.equal(C.longDate('x'), '');
  });
});

describe('numrering', () => {
  const st = (nasta, nrs) => ({ settings: { nastaNummer: nasta }, invoices: nrs.map((nr) => ({ nr })) });
  test('inställningen gäller när inga högre nummer är använda', () => {
    assert.equal(C.nextNumber(fx().state), 110);   // 107, 108, 109 används redan
    assert.equal(C.nextNumber(st(107, [])), 107);
    assert.equal(C.nextNumber(st(200, [107, 108])), 200);
  });
  test('högsta använda + 1 vinner över en lägre inställning', () => {
    assert.equal(C.nextNumber(st(1, [5, 3, 12])), 13);
    assert.equal(C.nextNumber(st(107, [107, null, 110])), 111);
  });
  test('utan inställningar börjar serien på 1', () => {
    assert.equal(C.nextNumber({ invoices: [] }), 1);
    assert.equal(C.nextNumber(st('abc', [])), 1);
    assert.equal(C.nextNumber(st(0, [])), 1);
    assert.equal(C.nextNumber(st(12.7, [])), 12);
  });
});

describe('validate', () => {
  const f = fx(); const f107 = byId(f, 'f107'); const seller = f107.saljare;
  test('f107 med fixturens säljare är felfri utan varningar', () => {
    assert.deepEqual(C.validate(f107, seller), { errors: [], warnings: [] });
  });
  test('momsregistreringsnummer krävs när fakturan har moms', () => {
    const r = C.validate(f107, Object.assign({}, seller, { momsregnr: '' }));
    assert.ok(r.errors.some((e) => /Momsregistreringsnummer/.test(e)), r.errors.join(' | '));
    const noVat = Object.assign({}, f107, { lines: [{ name: 'Presentkort', qty: 1, unit: 'st', price: 500, vat: 0 }] });
    assert.deepEqual(C.validate(noVat, Object.assign({}, seller, { momsregnr: '' })).errors, []);
  });
  test('inga rader och saknad kund', () => {
    const r = C.validate(Object.assign({}, f107, { lines: [{ name: '', qty: 1, price: null, vat: 6 }], kund: {} }), seller);
    assert.ok(r.errors.includes('Kunden saknar namn.'));
    assert.ok(r.errors.includes('Kunden saknar adress.'));
    assert.ok(r.errors.includes('Fakturan har inga rader med antal och pris.'));
    const onlyOrt = C.validate(Object.assign({}, f107, { kund: { namn: 'X', ort: 'Solna' } }), seller);
    assert.ok(!onlyOrt.errors.includes('Kunden saknar adress.'));
  });
  test('rad utan benämning, saknat datum och säljaruppgifter', () => {
    const inv = Object.assign({}, f107, { datum: '', lines: [{ name: '', qty: 2, price: 10, vat: 6 }] });
    const r = C.validate(inv, {});
    for (const e of ['Rad 1 saknar benämning.', 'Fakturadatum saknas.', 'Ditt företagsnamn saknas under Inställningar.', 'Ditt organisationsnummer saknas under Inställningar.', 'Din adress saknas under Inställningar.']) assert.ok(r.errors.includes(e), e);
    assert.equal(new Set(r.errors).size, r.errors.length);
  });
  test('varningar: betalningsuppgifter, leveransdatum, belopp 0 och kundens e-post', () => {
    const inv = Object.assign({}, f107, { leveransdatum: '', kund: Object.assign({}, f107.kund, { epost: '' }), lines: [{ name: 'Gratis', qty: 1, price: 0, vat: 6 }] });
    const r = C.validate(inv, Object.assign({}, seller, { plusgiro: '' }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 4);
    assert.ok(r.warnings.some((w) => /betalningsuppgifter/.test(w)));
    assert.ok(r.warnings.some((w) => /Leveransdatum/.test(w)));
    assert.ok(r.warnings.some((w) => /0 kr/.test(w)));
    assert.ok(r.warnings.some((w) => /e-post/.test(w)));
  });
  test('kreditfakturan varnar inte för negativt belopp', () => {
    const k109 = byId(fx(), 'k109');
    assert.deepEqual(C.validate(k109, k109.saljare), { errors: [], warnings: [] });
  });
});

describe('inmatning och format', () => {
  test('parseNum', () => {
    assert.equal(C.parseNum('1 234,50'), 1234.5);
    assert.equal(C.parseNum(`1${NB}234,50`), 1234.5);
    assert.equal(C.parseNum('12,5'), 12.5);
    assert.equal(C.parseNum('\u22123'), -3);
    assert.equal(C.parseNum('-3'), -3);
    assert.equal(C.parseNum('1234.5'), 1234.5);
    assert.equal(C.parseNum('12 kr'), 12);
    assert.equal(C.parseNum(',5'), 0.5);
    assert.equal(C.parseNum(7), 7);
    for (const bad of ['abc', '', null, undefined, '12,5,1', '-', NaN, Infinity, '1e5']) assert.equal(C.parseNum(bad), null, String(bad));
  });
  test('money, kr och num', () => {
    assert.equal(C.money(1700), `1${NB}700,00`);
    assert.equal(C.money(-1603.77), `-1${NB}603,77`);
    assert.equal(C.money(0.005), '0,01');
    assert.equal(C.money(-0.001), '0,00');
    assert.equal(C.kr(96.23), '96,23 kr');
    assert.equal(C.num(34), '34'); assert.equal(C.num(2.5), '2,5'); assert.equal(C.num(-34), '-34'); assert.equal(C.num(1.125, 3), '1,125');
  });
  test('suggestMomsregnr för 10 och 12 siffror', () => {
    assert.equal(C.suggestMomsregnr('850101-1234'), 'SE850101123401');
    assert.equal(C.suggestMomsregnr('19850101-1234'), 'SE850101123401');
    assert.equal(C.suggestMomsregnr('8501011234'), 'SE850101123401');
    assert.equal(C.suggestMomsregnr('556677-8899'), 'SE556677889901');
    assert.equal(C.suggestMomsregnr('123'), '');
    assert.equal(C.suggestMomsregnr(''), '');
    assert.equal(C.suggestMomsregnr(null), '');
  });
  test('defaultVat före och efter 2027-12-31', () => {
    const s = fx().settings;
    assert.equal(C.defaultVat(s, '2026-04-01'), 6);
    assert.equal(C.defaultVat(s, '2027-12-31'), 6);
    assert.equal(C.defaultVat(s, '2028-01-01'), 12);
    assert.equal(C.defaultVat(s, ''), 6);
    assert.equal(C.defaultVat(null, '2030-01-01'), 6);
    assert.equal(C.defaultVat(Object.assign({}, s, { momsEfter: 25 }), '2028-01-01'), 25);
  });
});

describe('status, titel och filnamn', () => {
  const f = fx(); const f108 = byId(f, 'f108'); const k109 = byId(f, 'k109');
  test('statusLabel med Förfallen och Reglerad', () => {
    assert.equal(C.statusLabel(f108, '2026-07-10'), 'Ej skickad');
    assert.equal(C.statusLabel(f108, '2026-07-11'), 'Förfallen');
    assert.equal(C.statusLabel(Object.assign({}, f108, { status: 'skickad' }), '2026-07-11'), 'Förfallen');
    assert.equal(C.statusLabel(Object.assign({}, f108, { status: 'betald' }), '2026-07-11'), 'Betald');
    assert.equal(C.statusLabel(byId(f, 'f107'), '2026-07-11'), 'Krediterad');
    assert.equal(C.statusLabel(byId(f, 'd1'), '2030-01-01'), 'Utkast');
    assert.equal(C.statusLabel(k109, '2030-01-01'), 'Ej skickad');   // kreditfakturor förfaller inte
    assert.equal(C.statusLabel(Object.assign({}, k109, { status: 'betald' })), 'Reglerad');
    assert.equal(C.displayStatus(f108, '2026-07-11'), 'forfallen');
  });
  test('title, filename och isFinal', () => {
    assert.equal(C.title(byId(f, 'f107')), 'Faktura 107');
    assert.equal(C.title(k109), 'Kreditfaktura 109');
    assert.equal(C.title(byId(f, 'd1')), 'Utkast');
    assert.equal(C.title(C.creditFor(f108, f.settings)), 'Utkast till kreditfaktura');
    assert.equal(C.filename(byId(f, 'f107')), 'faktura-107.pdf');
    assert.equal(C.filename(k109), 'kreditfaktura-109.pdf');
    assert.equal(C.filename(byId(f, 'd1')), 'faktura-utkast.pdf');
    assert.equal(C.isFinal(byId(f, 'd1')), false); assert.equal(C.isFinal(k109), true);
  });
});

describe('nya, kopierade och krediterade utkast', () => {
  const f = fx(); const s = f.settings; const kund = f.customers[0];
  test('blankInvoice', () => {
    const inv = C.blankInvoice(s, kund, '2026-10-26');
    assert.equal(inv.typ, 'faktura'); assert.equal(inv.status, 'utkast'); assert.equal(inv.nr, null);
    assert.equal(inv.customerId, 'k1'); assert.deepEqual(Object.keys(inv.kund), C.CUSTOMER_FIELDS);
    assert.equal(inv.kund.namn, kund.namn); assert.equal(inv.saljare, null);
    assert.equal(inv.datum, '2026-10-26'); assert.equal(inv.leveransdatum, '2026-10-26');
    assert.equal(inv.villkor, 14); assert.equal(inv.forfallodag, '2026-11-09');
    assert.equal(inv.varRef, 'Anna Bagare'); assert.equal(inv.erRef, 'Eva Exempel'); assert.equal(inv.markning, '');
    assert.equal(inv.priceMode, 'inkl'); assert.equal(inv.oresavrundning, false);
    assert.equal(inv.lines.length, 1); assert.equal(inv.lines[0].vat, 6); assert.equal(inv.lines[0].unit, 'st'); assert.equal(inv.lines[0].price, null);
    assert.equal(C.isEmptyLine(inv.lines[0]), true);
    for (const k of ['krediterar', 'krediteradAv', 'totals', 'finalizedAt', 'sentAt', 'paidAt']) assert.equal(inv[k], null, k);
    assert.deepEqual(inv.history, []); assert.ok(inv.id && inv.created && inv.updated);
  });
  test('blankInvoice: kundens villkor, inställningens villkor, exkl. och moms efter 2027', () => {
    assert.equal(C.blankInvoice(s, f.customers[1], '2026-10-26').villkor, 30);
    const noTerms = Object.assign({}, kund, { villkor: null });
    assert.equal(C.blankInvoice(Object.assign({}, s, { betalningsvillkor: 20 }), noTerms, '2026-10-26').villkor, 20);
    assert.equal(C.blankInvoice(Object.assign({}, s, { prisLage: 'exkl' }), kund, '2026-10-26').priceMode, 'exkl');
    assert.equal(C.blankInvoice(s, kund, '2028-01-05').lines[0].vat, 12);
    const anon = C.blankInvoice(s, null, '2026-10-26');
    assert.equal(anon.customerId, null); assert.equal(anon.kund.namn, '');
  });
  test('copyInvoice ger ett nytt utkast med samma kund och rader', () => {
    const src = byId(f, 'f108'); const cp = C.copyInvoice(src, s, '2026-10-26');
    assert.notEqual(cp.id, src.id); assert.equal(cp.status, 'utkast'); assert.equal(cp.nr, null); assert.equal(cp.typ, 'faktura');
    assert.equal(cp.datum, '2026-10-26'); assert.equal(cp.villkor, 30); assert.equal(cp.forfallodag, '2026-11-25');
    assert.deepEqual(cp.kund, src.kund); assert.notEqual(cp.kund, src.kund);
    assert.equal(cp.lines.length, src.lines.length);
    assert.ok(cp.lines.every((l, i) => l.id !== src.lines[i].id && l.name === src.lines[i].name && l.price === src.lines[i].price));
    assert.equal(cp.priceMode, 'exkl'); assert.equal(cp.oresavrundning, true); assert.equal(cp.markning, src.markning);
    assert.equal(cp.saljare, null); assert.equal(cp.totals, null); assert.equal(cp.krediterar, null);
    assert.deepEqual(sums(C.totals(cp)), sums(C.totals(src)));
  });
  test('copyInvoice av en kreditfaktura blir en vanlig faktura med positiva antal', () => {
    const cp = C.copyInvoice(byId(f, 'k109'), s, '2026-10-26');
    assert.equal(cp.typ, 'faktura'); assert.equal(cp.lines[0].qty, 34); assert.equal(cp.krediterar, null);
    assert.equal(C.totals(cp).toPay, 1700);
  });
  test('creditFor ger ett kreditutkast med negativa antal', () => {
    const src = byId(f, 'f108'); const cr = C.creditFor(src, s, '2026-10-26');
    assert.equal(cr.typ, 'kredit'); assert.equal(cr.status, 'utkast'); assert.equal(cr.nr, null);
    assert.deepEqual(cr.krediterar, { id: 'f108', nr: 108, datum: '2026-06-10' });
    assert.equal(cr.villkor, 0); assert.equal(cr.datum, '2026-10-26'); assert.equal(cr.forfallodag, '2026-10-26');
    assert.equal(cr.leveransdatum, src.leveransdatum); assert.equal(cr.meddelande, 'Kreditering av faktura 108.');
    assert.equal(cr.priceMode, 'exkl'); assert.equal(cr.oresavrundning, true);
    src.lines.forEach((l, i) => {
      const c = cr.lines[i]; assert.notEqual(c.id, l.id);
      assert.equal(c.qty, C.hasAmount(l) ? -l.qty : l.qty, l.name);
    });
    assert.equal(C.isTextLine(cr.lines[3]), true);
  });
  test('sellerSnapshot har alla säljarfält och fskatt som boolean', () => {
    const snap = C.sellerSnapshot(Object.assign({}, s, { fskatt: 1 }));
    assert.deepEqual(Object.keys(snap), C.SELLER_FIELDS);
    assert.equal(snap.fskatt, true); assert.equal(snap.momsregnr, 'SE850101123401');
    assert.equal(C.sellerSnapshot(null).foretag, '');
  });
});
