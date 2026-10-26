// Renderar alla fakturor i tests/fixture.js till tests/out/*.pdf med samma pdf.js som appen.
// Kör: node tests/pdf-render.mjs   (sedan: python tests/check_pdf.py)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const { jsPDF } = require(join(root, 'vendor/jspdf.umd.min.js'));
const FakturaPdf = require(join(root, 'pdf.js'));
const fixture = require(join(here, 'fixture.js'))();

// Typsnitten som binära strängar, precis som i webbläsaren.
const fonts = Object.fromEntries(['Nunito-Regular', 'Nunito-ExtraBold', 'Sacramento-Regular']
  .map((n) => [n, readFileSync(join(root, 'vendor/fonts', `${n}.ttf`)).toString('latin1')]));

// Appens egen logga om den finns, annars kassans. Höjd/bredd läses ur PNG-huvudet.
const logoPath = [join(root, 'img/logo.png'), join(root, '../kassa/img/logo.png')].find((p) => existsSync(p));
let logo = null;
if (logoPath) {
  const png = readFileSync(logoPath);
  logo = { data: 'data:image/png;base64,' + png.toString('base64'), ratio: png.readUInt32BE(20) / png.readUInt32BE(16) };
}

// Påfrestande fall: stora belopp, alla betalsätt, långa texter, 0/12/25 % och en lång enhet.
const [f107, f108] = fixture.invoices;
const seller = Object.assign({}, f108.saljare, {
  bankgiro: '5555-1234', swish: '123 456 78 90', iban: 'SE45 5000 0000 0583 9825 7466', bic: 'ESSESESS',
  webb: 'www.lilbakery-exempel.se', epost: 'fakturor.och.bestallningar@lilbakery-exempel.se',
  drojsmalsranta: 'Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen, för närvarande referensräntan plus åtta procentenheter. Påminnelseavgift 60 kr tas ut enligt lag.',
  fakturaText: 'Tack för beställningen och välkommen åter till lil’bakery – vi ses på nästa pop-up!'
});
const stress = Object.assign({}, f108, {
  id: 'stress', nr: 987654, saljare: seller, priceMode: 'inkl',
  meddelande: 'Första stycket med ganska mycket text som ska brytas snyggt över flera rader utan att krocka med summeringen till höger.\nAndra stycket: leverans sker till lastkajen, ring på klockan märkt "Varumottagning".',
  lines: [
    { id: 's1', name: 'Bröllopstårta i sju våningar', qty: 3, unit: 'förpackningar', price: 412345.67, vat: 12 },
    { id: 's2', name: 'Presentkort', qty: 10, unit: 'st', price: 500, vat: 0 },
    { id: 's3', name: 'Catering, heldag', qty: 1, unit: 'st', price: 98765.43, vat: 25 },
    { id: 's4', name: 'Rabatt enligt avtal', qty: 1, unit: '', price: -5000, vat: 12 },
    ...f108.lines.slice(0, 6)
  ]
});
const k2 = Object.assign({}, fixture.invoices[2], { id: 'stress-kredit', priceMode: 'exkl', lines: [{ id: 'c', name: 'Leverans till kontoret', qty: -1, unit: 'st', price: 350, vat: 25 }, { id: 'c2', name: 'Brownie, klassisk', qty: -40, unit: 'st', price: 22.5, vat: 6 }] });
const empty = { id: 'empty', typ: 'faktura', status: 'utkast', nr: null, saljare: null, kund: {}, lines: [{ id: 'e', name: '', qty: 1, unit: 'st', price: null, vat: 6 }] };

const variants = [
  ...fixture.invoices.map((inv) => ({ name: inv.id, inv, assets: { logo, fonts } })),
  // Reservläge: utan typsnitt och logga (Helvetica, Latin-1).
  { name: 'f108-fallback', inv: f108, assets: { logo: null, fonts: null } },
  { name: 'stress', inv: stress, assets: { logo, fonts } },
  { name: 'stress-kredit', inv: k2, assets: { logo, fonts } },
  { name: 'empty', inv: empty, assets: { logo, fonts }, seller: {} },
  // Orimligt stort belopp: "Att betala" ska läggas på två rader i stället för att krocka.
  { name: 'huge', inv: Object.assign({}, f107, { id: 'huge', lines: [{ id: 'h', name: 'Bröllopstårtor till hela Sverige', qty: 9999999, unit: 'förpackningar', price: 98765432.1, vat: 25 }] }), assets: { logo, fonts } }
];
for (const v of variants) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'p', compress: true });
  FakturaPdf.draw(doc, v.inv, v.seller || fixture.settings, v.assets);
  const file = join(out, `${v.name}.pdf`);
  writeFileSync(file, Buffer.from(doc.output('arraybuffer')));
  console.log(`${v.name}.pdf  ${doc.getNumberOfPages()} sida/sidor  (${FakturaPdf.filename(v.inv)})`);
}
console.log('Logga:', logoPath || 'saknas');
