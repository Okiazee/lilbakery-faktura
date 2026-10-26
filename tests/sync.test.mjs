// Tester för sync.js: CSV, säkerhetskopior, mejl, Apps Script version 3 och anropen till Google.
// Kör: node --test faktura/tests/sync.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Sync = require('../sync.js');
const Calc = require('../calc.js');
const fixture = require('./fixture.js');
const KASSA = new URL('../../kassa/index.html', import.meta.url);

const BOM = '﻿';
const parseCsv = (csv) => csv.replace(/^﻿/, '').split('\r\n').map((r) => r.split(';'));

// ---------- CSV ----------
test('invoicesCsv: BOM, kontraktets kolumner, bara låsta fakturor i nummerordning', () => {
  const f = fixture();
  const csv = Sync.invoicesCsv([...f.invoices].reverse(), '2026-10-26');
  assert.ok(csv.startsWith(BOM));
  const rows = parseCsv(csv);
  assert.equal(rows[0].join(';'), 'Nummer;Typ;Fakturadatum;Leveransdatum;Förfallodag;Betaldatum;Status;Kund;Kundens orgnr;Netto 25 %;Moms 25 %;Netto 12 %;Moms 12 %;Netto 6 %;Moms 6 %;Netto 0 %;Öresavrundning;Att betala');
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['107', '108', '109']);   // utkastet är inte med
  rows.forEach((r) => assert.equal(r.length, 18));
});

test('invoicesCsv: belopp med decimalkomma för faktura 107 och kreditfakturan', () => {
  const f = fixture();
  const rows = parseCsv(Sync.invoicesCsv(f.invoices, '2026-10-26'));
  const col = (name) => rows[0].indexOf(name);
  const r107 = rows.find((r) => r[0] === '107');
  assert.equal(r107[col('Typ')], 'Faktura');
  assert.equal(r107[col('Fakturadatum')], '2026-05-05');
  assert.equal(r107[col('Leveransdatum')], '2026-05-06');
  assert.equal(r107[col('Status')], 'Krediterad');
  assert.equal(r107[col('Kund')], f.customers[0].namn);
  assert.equal(r107[col('Kundens orgnr')], f.customers[0].orgnr);
  assert.equal(r107[col('Netto 6 %')], '1603,77');
  assert.equal(r107[col('Moms 6 %')], '96,23');
  assert.equal(r107[col('Netto 25 %')], '0,00');
  assert.equal(r107[col('Öresavrundning')], '0,00');
  assert.equal(r107[col('Att betala')], '1700,00');
  const r109 = rows.find((r) => r[0] === '109');
  assert.equal(r109[col('Typ')], 'Kreditfaktura');
  assert.equal(r109[col('Netto 6 %')], '-1603,77');
  assert.equal(r109[col('Att betala')], '-1700,00');
});

test('invoicesCsv: satsernas belopp och öresavrundning stämmer med FakturaCalc för den långa fakturan', () => {
  const f = fixture(); const inv = f.invoices.find((i) => i.nr === 108);
  const t = Calc.totals(inv);
  const rows = parseCsv(Sync.invoicesCsv(f.invoices, '2026-10-26'));
  const r = rows.find((x) => x[0] === '108'); const col = (name) => rows[0].indexOf(name);
  const num = (s) => Number(s.replace(',', '.'));
  assert.equal(r[col('Status')], 'Förfallen');
  for (const rate of [25, 12, 6]) {
    const row = t.rows.find((x) => x.rate === rate) || { net: 0, vat: 0 };
    assert.equal(num(r[col(`Netto ${rate} %`)]), row.net);
    assert.equal(num(r[col(`Moms ${rate} %`)]), row.vat);
  }
  assert.equal(num(r[col('Öresavrundning')]), t.rounding);
  assert.equal(num(r[col('Att betala')]), t.toPay);
  assert.ok(Number.isInteger(t.toPay));
  assert.match(r[col('Att betala')], /^\d+,\d{2}$/);   // inga tusentalsavgränsare
});

test('invoicesCsv: sparade summor från låsningen används', () => {
  const f = fixture(); const inv = f.invoices.find((i) => i.nr === 107);
  inv.totals = Object.assign(Calc.totals(inv), { toPay: 1234.5 });
  const rows = parseCsv(Sync.invoicesCsv([inv], '2026-10-26'));
  assert.equal(rows[1][17], '1234,50');
});

test('customersCsv: rubriker, citattecken och semikolon i fält', () => {
  const f = fixture();
  const c = Object.assign({}, f.customers[0], { namn: 'Kaka; "Bulle" AB', archived: true });
  const csv = Sync.customersCsv([f.customers[1], c]);
  assert.ok(csv.startsWith(BOM));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Namn;Organisationsnummer;Adress;Postnummer;Ort;Land;Kontaktperson;E-post;Telefon;Betalningsvillkor \(dagar\);Anteckning;Arkiverad$/);
  assert.ok(lines[1].startsWith('"Kaka; ""Bulle"" AB";'));   // sorterat på namn
  assert.ok(lines[1].endsWith(';ja'));
});

// ---------- Säkerhetskopia ----------
test('backupObject och readBackupFile: tur och retur', async () => {
  const f = fixture();
  const obj = Sync.backupObject(f.state);
  assert.equal(obj.app, 'lilbakery-faktura');
  assert.ok(obj.version);
  assert.ok(!Number.isNaN(Date.parse(obj.exportedAt)));
  const file = new File([JSON.stringify(obj, null, 1)], 'faktura-backup-2026-10-26.json', { type: 'application/json' });
  const state = await Sync.readBackupFile(file);
  assert.deepEqual(state.settings, f.state.settings);
  assert.deepEqual(state.customers, f.state.customers);
  assert.deepEqual(state.invoices, f.state.invoices);
  assert.deepEqual(state.items, []);   // saknas i fixturen och fylls i
  assert.deepEqual(state.meta, f.state.meta);
});

test('readBackupFile: tål BOM och avvisar kassans kopia, fel JSON och ofullständig kopia', async () => {
  const f = fixture();
  const ok = new File([BOM + JSON.stringify(Sync.backupObject(f.state))], 'kopia.json');
  assert.equal((await Sync.readBackupFile(ok)).invoices.length, f.state.invoices.length);
  const kassa = new File([JSON.stringify({ app: 'lilbakery-kassa', version: '1.7.1', state: { settings: {}, receipts: [] } })], 'lilbakery-kassa-backup-2026-10-26.json');
  await assert.rejects(Sync.readBackupFile(kassa), /kassan/);
  await assert.rejects(Sync.readBackupFile(new File(['{inte json'], 'x.json')), /säkerhetskopia/);
  await assert.rejects(Sync.readBackupFile(new File([JSON.stringify({ app: 'annat', state: {} })], 'x.json')), /inte en säkerhetskopia/);
  const broken = { app: 'lilbakery-faktura', state: { settings: {}, customers: [] } };
  await assert.rejects(Sync.readBackupFile(new File([JSON.stringify(broken)], 'x.json')), /fakturor saknas/);
  await assert.rejects(Sync.readBackupFile(new File(['PK'], 'Faktura 1.xlsx')), /Excel/);
  await assert.rejects(Sync.readBackupFile(null), /Ingen fil/);
});

// ---------- Mejl ----------
test('mailParts: ämne, belopp, förfallodag och betalningsreferens', () => {
  const f = fixture(); const inv = f.invoices.find((i) => i.nr === 107);
  const p = Sync.mailParts(inv, f.settings);
  assert.equal(p.subject, "Faktura 107 från lil'bakery");
  assert.match(p.text, /Ange fakturanummer 107 som meddelande/);
  assert.match(p.text, /Att betala: 1 700,00 kr/);
  assert.match(p.text, /Förfallodag: 2026-05-19/);
  assert.ok(p.text.includes(f.settings.plusgiro));
  assert.match(p.html, /^<!doctype html>/);
  assert.ok(p.html.includes(Sync.LOGO_URL));
  assert.equal(Sync.LOGO_URL, 'https://okiazee.github.io/lilbakery-kassa/img/logo.png');
  assert.ok(p.html.includes('1 700,00 kr'));
  assert.ok(p.html.includes('Ange fakturanummer 107 som meddelande'));
  assert.ok(p.html.includes(Calc.longDate(inv.forfallodag)));
  assert.ok(p.html.includes('Godkänd för F-skatt'));
  assert.ok(!/Kreditbelopp/.test(p.html));
});

test('mailParts: kreditfaktura har egen text och ingen betalningsuppmaning', () => {
  const f = fixture(); const inv = f.invoices.find((i) => i.nr === 109);
  const p = Sync.mailParts(inv, f.settings);
  assert.equal(p.subject, "Kreditfaktura 109 från lil'bakery");
  assert.match(p.text, /kreditfaktura 109/);
  assert.match(p.text, /avser faktura 107/);
  assert.match(p.text, /Kreditbelopp: -1 700,00 kr/);
  assert.ok(!/Ange fakturanummer/.test(p.text));
  assert.ok(!/Betala senast/.test(p.text));
  assert.ok(p.html.includes('Avser faktura 107'));
  assert.ok(!p.html.includes('Ange fakturanummer'));
});

test('mailParts: all användartext escapas i HTML', () => {
  const f = fixture(); const inv = JSON.parse(JSON.stringify(f.invoices.find((i) => i.nr === 107)));
  inv.erRef = '<script>alert(1)</script>';
  inv.markning = 'a & b "c"';
  inv.saljare = Object.assign({}, inv.saljare, { foretag: 'Kaka <b>& Co</b>', fakturaText: '<img src=x onerror=alert(2)>', plusgiro: '1<2' });
  const p = Sync.mailParts(inv, null);
  assert.ok(!p.html.includes('<script>alert'));
  assert.ok(!p.html.includes('<img src=x'));
  assert.ok(!p.html.includes('<b>& Co'));
  assert.ok(p.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(p.html.includes('a &amp; b &quot;c&quot;'));
  assert.ok(p.html.includes('alt="Kaka &lt;b&gt;&amp; Co&lt;/b&gt;"'));
  assert.ok(p.html.includes('1&lt;2'));
  assert.equal(p.subject, 'Faktura 107 från Kaka <b>& Co</b>');   // ämnet är ren text
  assert.ok(p.text.includes('<script>alert(1)</script>'));
});

test('mailParts: utkast använder seller och får ingen betalningsreferens', () => {
  const f = fixture(); const draft = f.invoices.find((i) => i.status === 'utkast');
  const p = Sync.mailParts(draft, f.settings);
  assert.equal(p.subject, "Utkast från lil'bakery");
  assert.ok(!/Ange fakturanummer/.test(p.text));
  assert.ok(!/null/.test(p.text));
});

test('mailtoUrl: adressen rensas och texten kodas', () => {
  const f = fixture(); const inv = f.invoices.find((i) => i.nr === 107);
  const u = Sync.mailtoUrl(inv, f.settings, ' eva@example.se<>; ');
  assert.ok(u.startsWith('mailto:eva@example.se?subject='));
  const q = new URLSearchParams(u.slice(u.indexOf('?') + 1));
  assert.equal(q.get('subject'), "Faktura 107 från lil'bakery");
  assert.match(q.get('body'), /Ange fakturanummer 107 som meddelande/);
  assert.ok(q.get('body').includes('\r\n'));
});

// ---------- Apps Script version 3 ----------
// Ett litet låtsas-Google: mappar, filer, e-post. Skriptet körs på riktigt i en vm-kontext.
function appsScript(key) {
  class Iter { constructor(a) { this.a = a.slice(); } hasNext() { return this.a.length > 0; } next() { return this.a.shift(); } }
  class GFile {
    constructor(name, content, mime) { this.name = name; this.content = content; this.mime = mime; this.trashed = false; }
    setContent(c) { this.content = c; } setTrashed(t) { this.trashed = t; }
    getLastUpdated() { return new Date('2026-10-26T10:00:00Z'); }
    getBlob() { return { getDataAsString: () => this.content }; }
  }
  class Folder {
    constructor(name) { this.name = name; this.files = []; this.folders = []; }
    getFilesByName(n) { return new Iter(this.files.filter((f) => f.name === n && !f.trashed)); }
    createFile(a, b, c) { const f = typeof a === 'string' ? new GFile(a, b, c) : new GFile(a.name, a.bytes, a.type); this.files.push(f); return f; }
    getFoldersByName(n) { return new Iter(this.folders.filter((f) => f.name === n)); }
    createFolder(n) { const f = new Folder(n); this.folders.push(f); return f; }
    live(n) { return this.files.filter((f) => f.name === n && !f.trashed); }
  }
  const drive = []; const mails = [];
  const env = {
    DriveApp: { getFoldersByName: (n) => new Iter(drive.filter((f) => f.name === n)), createFolder: (n) => { const f = new Folder(n); drive.push(f); return f; } },
    MailApp: { sendEmail: (o) => mails.push(o) },
    Utilities: { formatDate: () => '2026-10-26', base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: (bytes, type, name) => ({ bytes, type, name }) },
    Session: { getScriptTimeZone: () => 'Europe/Stockholm' },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) }
  };
  const fns = vm.runInNewContext(Sync.scriptText(key) + '\n;({ doPost, doGet })', env);
  return {
    drive, mails,
    post: (data) => fns.doPost({ postData: { contents: JSON.stringify(data) } }),
    get: (parameter) => fns.doGet({ parameter }),
    root: () => drive.find((f) => f.name === "lil'bakery Kassa")
  };
}

test('scriptText: version 3, nyckeln ifylld och rensad', () => {
  const s = Sync.scriptText('abc-123_X');
  assert.match(s, /version 3/);
  assert.match(s, /const NYCKEL = 'abc-123_X';/);
  assert.match(s, /version: 3, faktura: true/);
  assert.match(Sync.scriptText("x';alert(1)//"), /const NYCKEL = 'xalert1';/);
  assert.match(Sync.scriptText(), /const NYCKEL = '';/);
  assert.equal(Sync.SCRIPT_VERSION, 3);
});

test('scriptText: ping, fel nyckel och kassans backup som förut', () => {
  const g = appsScript('nyckel1');
  assert.deepEqual(g.get({ key: 'nyckel1', action: 'ping' }), { ok: true, mail: true, version: 3, faktura: true });
  assert.equal(g.get({ key: 'fel', action: 'ping' }).error, 'Fel nyckel');
  assert.equal(g.post({ key: 'fel', backup: {} }).error, 'Fel nyckel');
  assert.equal(g.get({ key: 'nyckel1' }).error, 'Ingen kopia finns');
  const kassa = { app: 'lilbakery-kassa', state: { receipts: [1, 2] } };
  const r = g.post({ key: 'nyckel1', day: '2026-10-25', csv: 'a;b', backup: kassa });
  assert.equal(r.ok, true);
  const root = g.root();
  assert.equal(root.live('kassa-backup-senaste.json').length, 1);
  assert.equal(root.live('kassa-backup-2026-10-25.json').length, 1);
  assert.equal(root.live('dagsavslut-2026-10-25.csv')[0].content, 'a;b');
  assert.equal(root.folders.length, 0);   // kassan skapar ingen fakturamapp
  assert.equal(g.post({ key: 'nyckel1' }).error, 'Kopian saknas');
  const back = g.get({ key: 'nyckel1' });
  assert.equal(back.ok, true); assert.deepEqual(back.backup, kassa);
});

test('scriptText: fakturans kopia och PDF hamnar i undermappen Fakturor och rör inte kassans kopia', () => {
  const g = appsScript('k');
  const kassa = { app: 'lilbakery-kassa', state: {} };
  g.post({ key: 'k', backup: kassa });
  const faktura = Sync.backupObject(fixture().state);
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
  const r = g.post({ key: 'k', app: 'faktura', day: '2026-10-26', backup: faktura, pdf, pdfName: '../faktura-107<>.pdf' });
  assert.equal(r.ok, true);
  const root = g.root(); const sub = root.folders.find((f) => f.name === 'Fakturor');
  assert.ok(sub);
  assert.equal(sub.live('faktura-backup-senaste.json').length, 1);
  assert.equal(sub.live('faktura-backup-2026-10-26.json').length, 1);
  assert.deepEqual(JSON.parse(root.live('kassa-backup-senaste.json')[0].content), kassa);
  assert.equal(root.live('faktura-backup-senaste.json').length, 0);
  const pdfs = sub.files.filter((f) => /\.pdf$/.test(f.name));
  assert.equal(pdfs.length, 1);
  assert.doesNotMatch(pdfs[0].name, /[/\\<>]/);
  assert.equal(pdfs[0].mime, 'application/pdf');
  assert.equal(Buffer.from(pdfs[0].content).toString(), '%PDF-1.4 test');
  // Samma faktura igen ersätter PDF:en.
  g.post({ key: 'k', app: 'faktura', day: 'inte-ett-datum', backup: faktura, pdf, pdfName: pdfs[0].name });
  assert.equal(sub.live(pdfs[0].name).length, 1);
  assert.equal(sub.files.filter((f) => f.trashed).length, 1);
  assert.equal(sub.live('faktura-backup-2026-10-26.json').length, 1);   // ogiltig dag ger skriptets datum
  // Utan namn får PDF:en ett standardnamn.
  g.post({ key: 'k', app: 'faktura', backup: faktura, pdf });
  assert.equal(sub.live('faktura.pdf').length, 1);
  // GET ?app=faktura ger fakturornas kopia, GET utan app kassans.
  assert.equal(g.get({ key: 'k', app: 'faktura' }).backup.app, 'lilbakery-faktura');
  assert.equal(g.get({ key: 'k' }).backup.app, 'lilbakery-kassa');
  assert.equal(g.post({ key: 'k', app: 'faktura' }).error, 'Kopian saknas');
});

test('scriptText: mejl med bilaga fungerar som i version 2', () => {
  const g = appsScript('k');
  const r = g.post({ key: 'k', action: 'mail', to: 'eva@example.se', subject: 'Faktura 107', text: 'Hej', html: '<p>Hej</p>', pdf: Buffer.from('x').toString('base64'), filename: 'faktura-107.pdf', from: "lil'bakery" });
  assert.equal(r.ok, true);
  assert.equal(g.mails.length, 1);
  assert.equal(g.mails[0].to, 'eva@example.se');
  assert.equal(g.mails[0].htmlBody, '<p>Hej</p>');
  assert.equal(g.mails[0].name, "lil'bakery");
  assert.equal(g.mails[0].attachments[0].name, 'faktura-107.pdf');
  assert.equal(g.post({ key: 'k', action: 'mail', to: 'inte en adress' }).error, 'Ogiltig e-postadress');
  // Kassans kvittomejl utan bilaga.
  g.post({ key: 'k', action: 'mail', to: 'kund@example.se', subject: 'Kvitto #5', text: 't' });
  assert.equal(g.mails[1].attachments.length, 0);
  assert.equal(g.drive.length, 0);   // mejl skapar inga mappar
});

test('kassan visar exakt samma skript (bara nyckeln skiljer)', { skip: !existsSync(KASSA) && 'kassa/index.html saknas' }, () => {
  const html = readFileSync(KASSA, 'utf8');
  const m = /function driveScriptText\(\) \{\r?\n  return `([\s\S]*?)`;\r?\n\}/.exec(html);
  assert.ok(m, 'driveScriptText hittades inte i kassan');
  const key = 'testnyckel-42';
  const kassaText = new Function('state', 'return `' + m[1] + '`;')({ settings: { driveKey: key } });
  assert.equal(kassaText, Sync.scriptText(key));
  assert.equal(new Function('state', 'return `' + m[1] + '`;')({ settings: {} }), Sync.scriptText(''));
  assert.match(html, /json\.mail === true/);   // kassans mejlkontroll fungerar med version 3
  assert.match(html, /const APP_VERSION = '1\.7\.2';/);
});

// ---------- Anrop till Google (fetch byts ut) ----------
const SETTINGS = { driveUrl: 'https://script.google.com/macros/s/TEST123/exec', driveKey: 'nyckel', foretag: "lil'bakery" };
let calls = [];
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url); const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: opts.method || 'GET', body });
    const out = await handler(u, body);
    return { status: 200, text: async () => (typeof out === 'string' ? out : JSON.stringify(out)) };
  };
}
const pings = () => calls.filter((c) => c.method === 'GET' && c.url.searchParams.get('action') === 'ping').length;
const posts = () => calls.filter((c) => c.method === 'POST');
beforeEach(() => Sync.resetPing());

test('driveUrlProblem: tom, /dev, fel och rätt adress', () => {
  assert.match(Sync.driveUrlProblem(''), /Klistra in/);
  assert.match(Sync.driveUrlProblem('https://script.google.com/macros/s/abc/dev'), /\/dev/);
  assert.match(Sync.driveUrlProblem('https://example.com/exec'), /webbapp-adress/);
  assert.equal(Sync.driveUrlProblem(SETTINGS.driveUrl), '');
  assert.equal(Sync.IN_PREVIEW, false);
});

test('uploadBackup: vägrar skicka till version 2 (kassans kopia skulle skrivas över)', async () => {
  mockFetch(() => ({ ok: true, mail: true, version: 2 }));
  const state = Object.assign(fixture().state, { settings: Object.assign(fixture().settings, SETTINGS) });
  await assert.rejects(Sync.uploadBackup(state, {}), (e) => {
    assert.match(e.message, /^Skriptet behöver uppdateras till version 3/);
    assert.match(e.message, /samma projekt/);
    assert.match(e.message, /Ny version/);
    assert.equal(e.code, 'script-outdated'); assert.equal(e.scriptVersion, 2);
    return true;
  });
  assert.equal(posts().length, 0);
  // Skript äldre än version 2 svarar på ping med kassans kopia.
  Sync.resetPing();
  mockFetch(() => ({ ok: true, updated: '2026-01-01T00:00:00Z', backup: { app: 'lilbakery-kassa' } }));
  await assert.rejects(Sync.uploadBackup(state), /version 3 \(det som körs nu är version 1\)/);
  assert.equal(posts().length, 0);
});

test('uploadBackup: version 3 får kopian och PDF:en, ping sparas mellan anropen', async () => {
  mockFetch((u, body) => (body ? { ok: true, saved: '2026-10-26T12:00:00Z' } : { ok: true, mail: true, version: 3, faktura: true }));
  const f = fixture(); const state = Object.assign(f.state, { settings: Object.assign(f.settings, SETTINGS) });
  const pdf = new Blob(['%PDF-1.4 hej'], { type: 'application/pdf' });
  const r = await Sync.uploadBackup(state, { pdf, pdfName: 'faktura-107.pdf' });
  assert.deepEqual(r, { ok: true, saved: '2026-10-26T12:00:00Z' });
  const [p] = posts();
  assert.equal(p.url.href, SETTINGS.driveUrl);
  assert.equal(p.body.key, 'nyckel');
  assert.equal(p.body.app, 'faktura');
  assert.ok(!('action' in p.body));
  assert.match(p.body.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p.body.backup.app, 'lilbakery-faktura');
  assert.equal(p.body.backup.state.invoices.length, f.state.invoices.length);
  assert.equal(Buffer.from(p.body.pdf, 'base64').toString(), '%PDF-1.4 hej');
  assert.equal(p.body.pdfName, 'faktura-107.pdf');
  await Sync.uploadBackup(state);
  assert.equal(pings(), 1);
  assert.ok(!('pdf' in posts()[1].body));
  const ping = calls.find((c) => c.method === 'GET').url;
  assert.equal(ping.searchParams.get('key'), 'nyckel');
  await Sync.ping(SETTINGS, { force: true });
  assert.equal(pings(), 2);
});

test('uploadBackup: frågar skriptet igen om det uppdaterats sedan förra kontrollen', async () => {
  let version = 2;
  mockFetch((u, body) => (body ? { ok: true, saved: 'nu' } : { ok: true, mail: true, version, faktura: version >= 3 }));
  assert.equal((await Sync.ping(SETTINGS)).version, 2);
  version = 3;
  const r = await Sync.uploadBackup({ settings: SETTINGS, customers: [], invoices: [] });
  assert.equal(r.ok, true);
  assert.equal(posts().length, 1);
});

test('ping: fel nyckel, inloggningssida och nätverksfel ger svenska förklaringar', async () => {
  mockFetch(() => ({ ok: false, error: 'Fel nyckel' }));
  await assert.rejects(Sync.ping(SETTINGS), /nyckeln stämmer inte/);
  mockFetch(() => '<html>Sign in - Google Accounts accounts.google.com</html>');
  await assert.rejects(Sync.ping(SETTINGS, { force: true }), /kräver inloggning/);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(Sync.ping(SETTINGS, { force: true }), /Anropet gick inte fram/);
  await assert.rejects(Sync.ping({ driveUrl: 'https://script.google.com/macros/s/x/dev' }), /\/dev/);
  assert.match(Sync.friendlyError(new Error('Exception: Service invoked too many times for one day: email.')), /gräns/);
  assert.match(Sync.friendlyError('Fel nyckel'), /nyckeln stämmer inte/);
});

test('fetchBackup: hämtar fakturornas kopia och avvisar kassans', async () => {
  const f = fixture(); const backup = Sync.backupObject(f.state);
  mockFetch((u) => (u.searchParams.get('action') === 'ping' ? { ok: true, mail: true, version: 3, faktura: true } : { ok: true, updated: '2026-10-26T09:00:00Z', backup }));
  const r = await Sync.fetchBackup(SETTINGS);
  assert.equal(r.updated, '2026-10-26T09:00:00Z');
  assert.equal(r.state.invoices.length, f.state.invoices.length);
  assert.equal(calls.at(-1).url.searchParams.get('app'), 'faktura');
  mockFetch((u) => (u.searchParams.get('action') === 'ping' ? { ok: true, mail: true, version: 3, faktura: true } : { ok: false, error: 'Ingen kopia finns' }));
  await assert.rejects(Sync.fetchBackup(SETTINGS), /ingen kopia av fakturorna/);
  mockFetch((u) => (u.searchParams.get('action') === 'ping' ? { ok: true, mail: true, version: 3, faktura: true } : { ok: true, updated: 'x', backup: { app: 'lilbakery-kassa', state: {} } }));
  await assert.rejects(Sync.fetchBackup(SETTINGS), /kassan/);
  Sync.resetPing();
  mockFetch(() => ({ ok: true, mail: true, version: 2 }));
  await assert.rejects(Sync.fetchBackup(SETTINGS), /version 3/);
  assert.equal(calls.filter((c) => c.url.searchParams.get('app')).length, 0);
});

test('sendMail: skickar via action mail, kräver mejlstöd och giltig adress', async () => {
  mockFetch((u, body) => (body ? { ok: true, sent: '2026-10-26T12:00:00Z' } : { ok: true, mail: true, version: 2 }));
  const f = fixture(); const parts = Sync.mailParts(f.invoices[0], f.settings);
  const r = await Sync.sendMail(SETTINGS, { to: 'eva@example.se', ...parts, pdf: new Blob(['%PDF']), filename: 'faktura-107.pdf' });
  assert.deepEqual(r, { ok: true, sent: '2026-10-26T12:00:00Z' });
  const p = posts()[0].body;
  assert.equal(p.action, 'mail'); assert.equal(p.to, 'eva@example.se'); assert.equal(p.subject, parts.subject);
  assert.equal(p.html, parts.html); assert.equal(p.text, parts.text); assert.equal(p.filename, 'faktura-107.pdf');
  assert.equal(p.from, "lil'bakery"); assert.equal(Buffer.from(p.pdf, 'base64').toString(), '%PDF');
  await assert.rejects(Sync.sendMail(SETTINGS, { to: 'fel' }), /giltig e-postadress/);
  Sync.resetPing();
  mockFetch(() => ({ ok: false, error: 'Ingen kopia finns' }));   // skript före version 2
  await assert.rejects(Sync.sendMail(SETTINGS, { to: 'eva@example.se' }), /skicka mejl/);
  Sync.resetPing();
  mockFetch((u, body) => (body ? { ok: false, error: 'Exception: Service invoked too many times for one day: email.' } : { ok: true, mail: true, version: 3, faktura: true }));
  await assert.rejects(Sync.sendMail(SETTINGS, { to: 'eva@example.se' }), /gräns/);
});

test('friendlyError: behörighetsfel översätts bara en gång', () => {
  const raw = 'Exception: Du har inte behörighet att ringa MailApp.sendEmail. Behörigheter som krävs: https://www.googleapis.com/auth/script.send_mail';
  const once = Sync.friendlyError(new Error(raw));
  assert.match(once, /^Google har inte godkänt/);
  assert.equal(Sync.friendlyError(new Error(once)), once);
  assert.equal(once.split('Google har inte godkänt').length, 2);
});
