/* lil'bakery Faktura: säkerhetskopior, Google Drive, e-post, CSV och nedladdning.
   Funktionerna tar in det de behöver som argument, inget globalt state. Google-skriptet (version 3) delas med kassan.
   I webbläsaren: window.FakturaSync. I Node: require('./sync.js') (nedladdning och delning kräver webbläsaren). */
(function (root) {
  'use strict';
  const Calc = (root && root.FakturaCalc) || (typeof require === 'function' ? require('./calc.js') : null);

  const APP = 'lilbakery-faktura';
  const BACKUP_VERSION = 1;
  const SCRIPT_VERSION = 3;
  const LOGO_URL = 'https://okiazee.github.io/lilbakery-kassa/img/logo.png';
  const PUBLIC_URL = 'https://okiazee.github.io/lilbakery-faktura/';
  const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
  const IN_PREVIEW = hasDom && typeof location !== 'undefined' && (/claude/i.test(location.hostname) || (window.top !== window.self && !/localhost|127\.0\.0\.1/.test(location.hostname)));
  const PREVIEW_MSG = `Det här är förhandsvisningen på claude.ai, och den får inte kontakta Google. Öppna fakturaappen på ${PUBLIC_URL} för att koppla och testa Google Drive.`;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const has = (v) => String(v ?? '').trim() !== '';
  const isTouch = () => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  // ---------- Säkerhetskopia ----------
  function backupObject(state) { return { app: APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), state }; }
  // Kontrollerar en kopia (fil eller Drive) och ger tillbaka dess state. Felen är skrivna för användaren.
  function stateFromBackup(data) {
    if (data && data.app === 'lilbakery-kassa') throw new Error('Det här är en säkerhetskopia från kassan, inte från fakturaappen. Välj en fil som börjar med faktura-backup. Kassans kopior läses in i kassan.');
    if (!data || typeof data !== 'object' || data.app !== APP || !data.state || typeof data.state !== 'object') throw new Error('Filen är inte en säkerhetskopia från fakturaappen. Välj filen som heter faktura-backup-ÅÅÅÅ-MM-DD.json.');
    const s = data.state; const missing = [];
    if (!s.settings || typeof s.settings !== 'object' || Array.isArray(s.settings)) missing.push('inställningar');
    if (!Array.isArray(s.customers) || s.customers.some((c) => !c || typeof c !== 'object')) missing.push('kunder');
    if (!Array.isArray(s.invoices) || s.invoices.some((i) => !i || typeof i !== 'object')) missing.push('fakturor');
    if (missing.length) throw new Error(`Säkerhetskopian är skadad eller ofullständig: ${missing.join(', ')} saknas. Välj en annan kopia.`);
    return Object.assign({}, s, {
      version: s.version || 1,
      items: Array.isArray(s.items) ? s.items : [],
      meta: s.meta && typeof s.meta === 'object' && !Array.isArray(s.meta) ? s.meta : {}
    });
  }
  function readText(file) {
    if (typeof file === 'string') return Promise.resolve(file);
    if (file && typeof file.text === 'function') return file.text();
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsText(file); });
  }
  async function readBackupFile(file) {
    if (!file) throw new Error('Ingen fil vald.');
    const name = String(file.name || '');
    if (/\.xls[xm]?$/i.test(name)) throw new Error('Det här är en Excel-fil. Gamla fakturor i Excel läses in med Importera från Excel, inte som säkerhetskopia.');
    let text;
    try { text = await readText(file); } catch (e) { throw new Error('Filen kunde inte läsas. Försök igen eller välj en annan fil.'); }
    let data;
    try { data = JSON.parse(String(text).replace(/^﻿/, '')); }
    catch (e) { throw new Error('Filen går inte att läsa som säkerhetskopia. Välj filen som heter faktura-backup-ÅÅÅÅ-MM-DD.json.'); }
    return stateFromBackup(data);
  }
  function downloadBackup(state) {
    return downloadText(`faktura-backup-${Calc.today()}.json`, JSON.stringify(backupObject(state), null, 1), 'application/json');
  }

  // ---------- Google Drive via Apps Script ----------
  const KEY_MSG = 'Skriptet svarar men nyckeln stämmer inte. Nyckeln i fältet ovan måste vara exakt samma som NYCKEL i skriptet, samma som i kassan.';
  const SCRIPT_UPDATE_HELP = 'Öppna samma projekt på script.google.com som kassan använder, markera all kod och ersätt den med skriptet under Inställningar, Google Drive (knappen Kopiera skriptet). Spara med Ctrl+S. Välj sedan Distribuera, Hantera distributioner, pennan, Version: Ny version och Distribuera. Adressen och nyckeln är desamma som förut, och kassan fungerar som vanligt med det nya skriptet.';
  function outdatedError(version, what) {
    const e = new Error(`Skriptet behöver uppdateras till version ${SCRIPT_VERSION} (det som körs nu är version ${version}) ${what || 'innan fakturorna kan sparas på Google Drive'}. ${SCRIPT_UPDATE_HELP}`);
    e.code = 'script-outdated'; e.scriptVersion = version; return e;
  }
  const driveConfigured = (url) => /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(String(url || '').trim());
  function driveUrlProblem(url) {
    if (IN_PREVIEW) return PREVIEW_MSG;
    const u = String(url || '').trim(); if (!u) return 'Klistra in webbappens adress först. Den ska sluta på /exec.';
    if (/\/dev\/?$/.test(u)) return 'Adressen slutar på /dev och är skriptets testadress. Gör en riktig distribution: Distribuera, Ny distribution, kugghjulet, Webbapp, Kör som Jag, åtkomst Alla. Kopiera sedan adressen som slutar på /exec.';
    if (!driveConfigured(u)) return 'Adressen ser inte ut som en webbapp-adress. Den ska börja med https://script.google.com/macros/s/ och sluta på /exec.';
    return '';
  }
  // Samma skript som kassan visar. Ändras det här måste kassans driveScriptText() ändras likadant (testet jämför dem).
  function scriptText(key) {
    const k = String(key || '').replace(/[^\w-]/g, '');
    return `// lil'bakery Kassa och Faktura, version 3: sparar säkerhetskopior på Google Drive och mejlar kvitton och fakturor.
const NYCKEL = '${k}';   // samma nyckel i kassans och fakturaappens inställningar
const MAPP = "lil'bakery Kassa";        // mappen skapas i Min enhet på Google Drive
const FAKTURAMAPP = 'Fakturor';         // undermapp i MAPP för fakturaappens kopior och PDF:er

// Kassan skickar utan app, fakturaappen med app: 'faktura'. Båda mejlar med action: 'mail'.
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.key !== NYCKEL) return svar({ ok: false, error: 'Fel nyckel' });
    if (data.action === 'mail') return skickaMejl(data);
    if (data.app === 'faktura') return sparaFaktura(data);
    if (!data.backup || typeof data.backup !== 'object') return svar({ ok: false, error: 'Kopian saknas' });
    const mapp = hamtaMapp();
    const dag = data.day || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const json = JSON.stringify(data.backup);
    skriv(mapp, 'kassa-backup-senaste.json', json);
    skriv(mapp, 'kassa-backup-' + dag + '.json', json);
    if (data.csv) skriv(mapp, 'dagsavslut-' + dag + '.csv', data.csv);
    return svar({ ok: true, saved: new Date().toISOString() });
  } catch (fel) { return svar({ ok: false, error: String(fel) }); }
}
function doGet(e) {
  if (!e.parameter || e.parameter.key !== NYCKEL) return svar({ ok: false, error: 'Fel nyckel' });
  if (e.parameter.action === 'ping') return svar({ ok: true, mail: true, version: 3, faktura: true });
  const faktura = e.parameter.app === 'faktura';
  const mapp = faktura ? hamtaFakturamapp() : hamtaMapp();
  const filer = mapp.getFilesByName(faktura ? 'faktura-backup-senaste.json' : 'kassa-backup-senaste.json');
  if (!filer.hasNext()) return svar({ ok: false, error: 'Ingen kopia finns' });
  const fil = filer.next();
  return svar({ ok: true, updated: fil.getLastUpdated().toISOString(), backup: JSON.parse(fil.getBlob().getDataAsString()) });
}
// Fakturaappen: kopian och fakturans PDF hamnar i undermappen Fakturor.
function sparaFaktura(data) {
  if (!data.backup || typeof data.backup !== 'object') return svar({ ok: false, error: 'Kopian saknas' });
  const mapp = hamtaFakturamapp();
  const dag = /^\\d{4}-\\d{2}-\\d{2}$/.test(data.day || '') ? data.day : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const json = JSON.stringify(data.backup);
  skriv(mapp, 'faktura-backup-senaste.json', json);
  skriv(mapp, 'faktura-backup-' + dag + '.json', json);
  if (data.pdf) sparaPdf(mapp, data.pdfName, data.pdf);
  return svar({ ok: true, saved: new Date().toISOString() });
}
// En faktura som skapas igen med samma nummer ersätter den gamla PDF:en (den gamla läggs i papperskorgen).
function sparaPdf(mapp, namn, pdf) {
  let fil = String(namn || '').replace(/[^\\w .,()åäöÅÄÖéÉüÜ-]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 100);
  if (!fil) fil = 'faktura.pdf';
  if (!/\\.pdf$/i.test(fil)) fil += '.pdf';
  const gamla = mapp.getFilesByName(fil);
  while (gamla.hasNext()) gamla.next().setTrashed(true);
  mapp.createFile(Utilities.newBlob(Utilities.base64Decode(pdf), 'application/pdf', fil));
}
function skickaMejl(data) {
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(data.to || '')) return svar({ ok: false, error: 'Ogiltig e-postadress' });
  const bilagor = data.pdf ? [Utilities.newBlob(Utilities.base64Decode(data.pdf), 'application/pdf', data.filename || 'kvitto.pdf')] : [];
  MailApp.sendEmail({ to: data.to, subject: data.subject || 'Kvitto', body: data.text || '', htmlBody: data.html || undefined, name: data.from || "lil'bakery", attachments: bilagor });
  return svar({ ok: true, sent: new Date().toISOString() });
}
function hamtaMapp() { const it = DriveApp.getFoldersByName(MAPP); return it.hasNext() ? it.next() : DriveApp.createFolder(MAPP); }
function hamtaFakturamapp() { const mapp = hamtaMapp(); const it = mapp.getFoldersByName(FAKTURAMAPP); return it.hasNext() ? it.next() : mapp.createFolder(FAKTURAMAPP); }
function skriv(mapp, namn, innehall) { const it = mapp.getFilesByName(namn); if (it.hasNext()) it.next().setContent(innehall); else mapp.createFile(namn, innehall, MimeType.PLAIN_TEXT); }
function svar(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }`;
  }

  // Skriptets korta felkoder och Googles egna fel blir svenska förklaringar.
  function scriptError(msg) {
    const m = String(msg || '');
    if (m === 'Fel nyckel') return KEY_MSG;
    if (m === 'Ingen kopia finns') return 'Det finns ingen kopia på Google Drive ännu.';
    if (m === 'Kopian saknas') return 'Kopian kom inte fram till skriptet. Försök igen.';
    if (m === 'Ogiltig e-postadress') return 'E-postadressen är ogiltig. Kontrollera adressen och försök igen.';
    if (/too many times|Service invoked|quota|kvot/i.test(m)) return 'Google har stoppat fler mejl från skriptet i dag (det finns en gräns per dag). Försök igen i morgon eller använd Öppna i Mail.';
    if (/permission|behörighet|not authori[sz]ed|Authorization is required/i.test(m)) return 'Google har inte godkänt att skriptet skickar e-post eller sparar på Drive. Öppna skriptet på script.google.com, välj funktionen hamtaMapp i listan bredvid Kör, klicka Kör och godkänn: välj ditt konto, Avancerat, Fortsätt till projektet (osäkert) och Tillåt. Försök sedan igen.';
    return m || 'Skriptet svarade med fel';
  }
  function friendlyError(err) {
    if (!err) return 'Okänt fel';
    return scriptError(err && err.message ? err.message : String(err));
  }
  // Samma felförklaringar som i kassan.
  async function driveJson(url, opts) {
    let res;
    try { res = await fetch(url, opts); }
    catch (e) { throw new Error('Anropet gick inte fram. Kontrollera uppkopplingen och att adressen är webbappens adress som slutar på /exec.'); }
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) {
      if (/accounts\.google\.com|ServiceLogin|Logga in|Sign in/i.test(text)) throw new Error('Google kräver inloggning för adressen. Öppna Distribuera, Hantera distributioner, pennan: sätt Kör som till Jag och Vem har åtkomst till Alla, välj Version: Ny version och tryck Distribuera.');
      if (/Script function not found|doGet|doPost/i.test(text)) throw new Error('Skriptet saknar funktionen doGet eller doPost. Klistra in hela skriptet, spara, och gör en ny version av distributionen.');
      if (/Authorization|Auktorisering|behörighet|permission/i.test(text)) throw new Error('Skriptet har inte fått tillgång till Drive. Öppna skriptet, välj funktionen hamtaMapp i listan bredvid Kör, klicka Kör och godkänn åtkomsten: välj ditt konto, Avancerat, Fortsätt till projektet (osäkert) och Tillåt.');
      throw new Error(`Skriptet svarade med en webbsida i stället för data (status ${res.status}). Kontrollera att distributionen är en webbapp med Kör som Jag och åtkomst för Alla, och att du gjort en ny version efter ändringar.`);
    }
  }
  function checkReply(json) {
    if (json && json.ok) return json;
    throw new Error(scriptError(json && json.error));
  }
  function driveTarget(settings) {
    const s = settings || {}; const url = String(s.driveUrl || '').trim();
    const problem = driveUrlProblem(url); if (problem) throw new Error(problem);
    return { url, key: String(s.driveKey || '') };
  }
  const query = (key, extra) => `?key=${encodeURIComponent(key)}&${extra}&t=${Date.now()}`;

  // Vilken version skriptet har. Svaret sparas per adress och nyckel tills sidan laddas om ({ force: true } frågar igen).
  const pingCache = new Map();
  async function ping(settings, opts) {
    const { url, key } = driveTarget(settings);
    const id = url + '\n' + key;
    if (!(opts && opts.force) && pingCache.has(id)) return pingCache.get(id);
    if (offline()) throw new Error('Ingen internetanslutning. Försök igen när enheten är uppkopplad.');
    const json = await driveJson(url + query(key, 'action=ping'));
    // Skript före version 2 känner inte till ping och svarar med kassans kopia eller "Ingen kopia finns".
    if (!json || (!json.ok && json.error !== 'Ingen kopia finns')) checkReply(json);
    const version = json.ok && Number(json.version) > 0 ? Number(json.version) : 1;
    const res = { ok: true, version, mail: !!json.ok && json.mail === true, faktura: !!json.ok && json.faktura === true };
    pingCache.set(id, res);
    return res;
  }
  function resetPing() { pingCache.clear(); }
  // Fakturans kopia får bara gå till version 3. Version 2 skulle skriva över kassans kopia.
  async function requireV3(settings, what) {
    let p = await ping(settings);
    if (p.version < SCRIPT_VERSION || !p.faktura) p = await ping(settings, { force: true });   // skriptet kan ha uppdaterats sedan sist
    if (p.version < SCRIPT_VERSION || !p.faktura) throw outdatedError(p.version, what);
    return p;
  }
  async function blobToBase64(blob) {
    if (typeof FileReader === 'function') {
      return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (typeof Buffer === 'function') return Buffer.from(bytes).toString('base64');
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const safePdfName = (name) => { let n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim(); if (!n) n = 'faktura.pdf'; return /\.pdf$/i.test(n) ? n : n + '.pdf'; };

  async function uploadBackup(state, opts) {
    const o = opts || {}; const settings = (state && state.settings) || {};
    const { url, key } = driveTarget(settings);
    if (offline()) throw new Error('Ingen uppkoppling. Kopian skickas när nätet är tillbaka.');
    await requireV3(settings);
    const payload = { key, app: 'faktura', day: Calc.today(), backup: backupObject(state) };
    if (o.pdf) { payload.pdf = await blobToBase64(o.pdf); payload.pdfName = safePdfName(o.pdfName); }
    const json = checkReply(await driveJson(url, { method: 'POST', body: JSON.stringify(payload) }));
    return { ok: true, saved: json.saved || new Date().toISOString() };
  }
  async function fetchBackup(settings) {
    const { url, key } = driveTarget(settings);
    if (offline()) throw new Error('Ingen internetanslutning. Försök igen när enheten är uppkopplad.');
    await requireV3(settings, 'innan fakturornas kopia kan hämtas från Google Drive');
    const json = await driveJson(url + query(key, 'app=faktura'));
    if (json && !json.ok && json.error === 'Ingen kopia finns') throw new Error('Det finns ingen kopia av fakturorna på Google Drive ännu.');
    checkReply(json);
    return { updated: json.updated || null, state: stateFromBackup(json.backup) };
  }
  async function sendMail(settings, msg) {
    const s = settings || {}; const m = msg || {};
    const { url, key } = driveTarget(s);
    const to = String(m.to || '').trim();
    if (!EMAIL_RE.test(to)) throw new Error('Skriv en giltig e-postadress.');
    if (offline()) throw new Error('Ingen internetanslutning. Använd Öppna i Mail eller försök igen senare.');
    let p = await ping(s);
    if (!p.mail) p = await ping(s, { force: true });
    if (!p.mail) throw outdatedError(p.version, 'för att kunna skicka mejl');
    const payload = { key, action: 'mail', to, subject: m.subject || '', text: m.text || '', html: m.html || '', from: has(s.foretag) ? String(s.foretag).trim() : "lil'bakery" };
    if (m.pdf) { payload.pdf = await blobToBase64(m.pdf); payload.filename = safePdfName(m.filename); }
    const json = checkReply(await driveJson(url, { method: 'POST', body: JSON.stringify(payload) }));
    return { ok: true, sent: json.sent || new Date().toISOString() };
  }

  // ---------- E-post ----------
  const C = { ink: '#2f4a4d', muted: '#6d8688', brand: '#3b7a80', line: '#d9e9ea', mist: '#f3f8f8', pink: '#c4536a', blush: '#fdf0f3' };
  const payRows = (s) => [['Plusgiro', s.plusgiro], ['Bankgiro', s.bankgiro], ['Swish', s.swish], ['IBAN', s.iban], ['BIC', s.bic]].filter(([, v]) => has(v)).map(([k, v]) => [k, String(v).trim()]);
  function sellerLines(s) {
    const addr = [s.adress, [s.postnr, s.ort].filter(has).join(' ')].filter(has).join(', ');
    const contact = [s.telefon, s.epost, s.webb].filter(has).join(' · ');
    const ids = [has(s.orgnr) ? `Org.nr ${s.orgnr}` : '', has(s.momsregnr) ? `Momsreg.nr ${s.momsregnr}` : '', s.fskatt ? 'Godkänd för F-skatt' : ''].filter(Boolean).join(' · ');
    return [s.foretag, addr, contact, ids].filter(has).map((x) => String(x).trim());
  }
  // Ämne, text och varumärkt HTML till mejlet med fakturan. seller används när fakturan saknar saljare (utkast).
  function mailParts(invoice, seller) {
    const inv = invoice || {}; const s = inv.saljare || seller || {};
    const t = inv.totals && Array.isArray(inv.totals.rows) ? inv.totals : Calc.totals(inv);
    const kredit = inv.typ === 'kredit'; const final = Calc.isFinal(inv);
    const firm = has(s.foretag) ? String(s.foretag).trim() : "lil'bakery";
    const title = Calc.title(inv);
    const titleLower = title.charAt(0).toLowerCase() + title.slice(1);
    const orig = inv.krediterar && inv.krediterar.nr != null ? inv.krediterar.nr : null;
    const pays = payRows(s);
    const refText = final ? `Ange fakturanummer ${inv.nr} som meddelande` : '';
    const vatRows = (t.rows || []).filter((r) => Number(r.rate) > 0);
    const markning = /[^\s\-–—]/.test(String(inv.markning || '')) ? String(inv.markning).trim() : '';
    const amountLabel = kredit ? 'Kreditbelopp' : 'Att betala';
    const pdfNote = kredit ? 'Kreditfakturan finns som PDF i bilagan.' : 'Fakturan finns som PDF i bilagan.';
    const intro = kredit
      ? `Här kommer ${titleLower} från ${firm}${orig != null ? `. Den avser faktura ${orig}` : ''}.`
      : `Här kommer ${titleLower} från ${firm}.`;
    const creditNote = `Beloppet dras av från det ni ska betala${orig != null ? ` för faktura ${orig}` : ''}. Har ni redan betalat betalar vi tillbaka beloppet.`;
    const details = [
      [kredit ? 'Kreditfaktura nr' : 'Fakturanummer', final ? String(inv.nr) : ''],
      [kredit ? 'Datum' : 'Fakturadatum', inv.datum || ''],
      [kredit ? '' : 'Förfallodag', kredit ? '' : (inv.forfallodag || '')],
      ['Avser faktura', kredit && orig != null ? String(orig) : ''],
      ['Er referens', inv.erRef || ''],
      ['Vår referens', inv.varRef || ''],
      ['Märkning', markning]
    ].filter(([a, b]) => a && has(b));
    const sums = [['Belopp exkl. moms', Calc.kr(t.net)], ...vatRows.map((r) => [`Moms ${Calc.num(r.rate)} %`, Calc.kr(r.vat)])];
    if (t.rounding) sums.push(['Öresavrundning', Calc.kr(t.rounding)]);

    // Ren text (också till Öppna i Mail).
    const L = ['Hej!', '', `${intro} ${pdfNote}`, ''];
    details.forEach(([a, b]) => L.push(`${a}: ${b}`));
    L.push('');
    sums.forEach(([a, b]) => L.push(`${a}: ${b}`));
    L.push(`${amountLabel}: ${Calc.kr(t.toPay)}`, '');
    if (kredit) L.push(creditNote);
    else {
      if (pays.length) { L.push(has(inv.forfallodag) ? `Betala senast ${inv.forfallodag} till:` : 'Betala till:'); pays.forEach(([a, b]) => L.push(`${a}: ${b}`)); }
      if (refText) L.push(`${refText}.`);
    }
    const thanks = !kredit && has(s.fakturaText) ? String(s.fakturaText).trim() : '';
    if (thanks) L.push('', thanks);
    L.push('', 'Vänliga hälsningar');
    if (has(s.namn)) L.push(String(s.namn).trim());
    sellerLines(s).forEach((x) => L.push(x));
    const text = L.join('\n');

    // HTML med tabeller och inbyggda stilar, så att det ser likadant ut i alla e-postprogram.
    const tbl = (inner, st = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${st}">${inner}</table>`;
    const kv = (a, b, st = '') => `<tr><td style="padding:4px 0;font-size:14px;color:${C.muted};${st}">${esc(a)}</td><td style="padding:4px 0 4px 12px;font-size:14px;color:${C.ink};text-align:right;${st}">${esc(b)}</td></tr>`;
    const heading = (h) => `<div style="font-size:15px;font-weight:bold;color:${C.ink};padding-bottom:6px;margin-bottom:4px;border-bottom:1px solid ${C.line}">${esc(h)}</div>`;
    const sub = [firm, Calc.longDate(inv.datum)].filter(has).map(esc).join(' · ');
    const due = !kredit && has(inv.forfallodag) ? `<div style="font-size:15px;color:${C.ink};margin-top:6px">senast <b>${esc(Calc.longDate(inv.forfallodag) || inv.forfallodag)}</b></div>` : '';
    const sumsHtml = sums.map(([a, b]) => kv(a, b)).join('')
      + `<tr><td style="padding:10px 0 4px;font-size:17px;font-weight:bold;color:${C.brand};border-top:1px solid ${C.line}">${esc(amountLabel)}</td><td style="padding:10px 0 4px 12px;font-size:17px;font-weight:bold;color:${C.brand};text-align:right;white-space:nowrap;border-top:1px solid ${C.line}">${esc(Calc.kr(t.toPay))}</td></tr>`;
    const payHtml = kredit
      ? `<tr><td style="padding:16px 32px 4px"><div style="padding:12px 14px;border-radius:12px;background:${C.blush};color:${C.pink};font-size:14px;line-height:1.5;text-align:center">${esc(creditNote)}</div></td></tr>`
      : `<tr><td style="padding:18px 32px 4px">${heading('Betalning')}${pays.length ? tbl(pays.map(([a, b]) => kv(a, b, 'font-weight:bold')).join('')) : ''}${refText ? `<div style="margin-top:10px;padding:12px 14px;border-radius:12px;background:${C.blush};color:${C.pink};font-size:15px;font-weight:bold;text-align:center">${esc(refText)}</div>` : ''}</td></tr>`;
    const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.mist}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.mist}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${C.line};border-radius:18px;font-family:Arial,Helvetica,sans-serif;color:${C.ink}">
<tr><td style="padding:30px 32px 4px;text-align:center"><img src="${LOGO_URL}" width="130" alt="${esc(firm)}" style="display:inline-block;width:130px;max-width:130px;height:auto;border:0"></td></tr>
<tr><td style="padding:10px 32px 18px;text-align:center">
<div style="font-size:24px;font-weight:bold;color:${C.ink}">${esc(title)}</div>
<div style="font-size:14px;color:${C.muted};margin-top:8px">${sub}</div>
${kredit && orig != null ? `<div style="font-size:14px;color:${C.pink};margin-top:4px;font-weight:bold">Avser faktura ${esc(orig)}</div>` : ''}
</td></tr>
<tr><td style="padding:0 32px 18px;font-size:15px;line-height:1.6;color:${C.ink}">Hej!<br>${esc(intro)}</td></tr>
<tr><td style="padding:0 32px">${tbl(`<tr><td style="padding:18px 20px;text-align:center"><div style="font-size:12px;color:${C.muted};text-transform:uppercase;letter-spacing:1px">${esc(amountLabel)}</div><div style="font-size:30px;font-weight:bold;color:${C.brand};margin-top:4px;white-space:nowrap">${esc(Calc.kr(t.toPay))}</div>${due}</td></tr>`, `background:${C.mist};border:1px solid ${C.line};border-radius:14px`)}</td></tr>
<tr><td style="padding:16px 32px 4px">${tbl(sumsHtml)}</td></tr>
${payHtml}
<tr><td style="padding:18px 32px 4px">${heading(kredit ? 'Kreditfaktura' : 'Faktura')}${tbl(details.map(([a, b]) => kv(a, b)).join(''))}</td></tr>
<tr><td style="padding:20px 32px 24px;text-align:center;font-size:13px;color:${C.muted};line-height:1.6">${thanks ? `<div style="font-size:15px;color:${C.ink};margin-bottom:6px">${esc(thanks)}</div>` : ''}${esc(pdfNote)}</td></tr>
<tr><td style="padding:18px 32px 22px;border-top:1px solid ${C.line};background:${C.mist};border-radius:0 0 18px 18px;text-align:center;font-size:12px;color:${C.muted};line-height:1.7">${sellerLines(s).map(esc).join('<br>')}</td></tr>
</table></td></tr></table></body></html>`;
    return { subject: `${title} från ${firm}`, text, html };
  }
  function mailtoUrl(invoice, seller, to) {
    const p = mailParts(invoice, seller); const addr = String(to || '').replace(/[^\w.@+-]/g, '');
    return `mailto:${addr}?subject=${encodeURIComponent(p.subject)}&body=${encodeURIComponent(p.text.replace(/\n/g, '\r\n'))}`;
  }

  // ---------- CSV (semikolon, UTF-8 med BOM, decimalkomma) ----------
  const BOM = '﻿';
  const csvNum = (n) => Calc.r2(n).toFixed(2).replace('.', ',');
  const csvRow = (cells) => cells.map((c) => { const s = String(c ?? ''); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';');
  const INVOICE_COLUMNS = ['Nummer', 'Typ', 'Fakturadatum', 'Leveransdatum', 'Förfallodag', 'Betaldatum', 'Status', 'Kund', 'Kundens orgnr', 'Netto 25 %', 'Moms 25 %', 'Netto 12 %', 'Moms 12 %', 'Netto 6 %', 'Moms 6 %', 'Netto 0 %', 'Öresavrundning', 'Att betala'];
  // Låsta fakturor och kreditfakturor, en rad per faktura i nummerordning. Sparade summor (från låsningen) gäller.
  function invoicesCsv(invoices, today) {
    const list = (invoices || []).filter(Calc.isFinal).slice().sort((a, b) => Number(a.nr) - Number(b.nr));
    const rows = [INVOICE_COLUMNS];
    list.forEach((inv) => {
      const t = inv.totals && Array.isArray(inv.totals.rows) ? inv.totals : Calc.totals(inv);
      const at = (rate) => t.rows.find((r) => Number(r.rate) === rate) || { net: 0, vat: 0 };
      const k = inv.kund || {};
      rows.push([
        inv.nr, inv.typ === 'kredit' ? 'Kreditfaktura' : 'Faktura', inv.datum || '', inv.leveransdatum || '', inv.forfallodag || '',
        inv.paidAt ? String(inv.paidAt).slice(0, 10) : '', Calc.statusLabel(inv, today), k.namn || '', k.orgnr || '',
        csvNum(at(25).net), csvNum(at(25).vat), csvNum(at(12).net), csvNum(at(12).vat), csvNum(at(6).net), csvNum(at(6).vat), csvNum(at(0).net),
        csvNum(t.rounding), csvNum(t.toPay)
      ]);
    });
    return BOM + rows.map(csvRow).join('\r\n');
  }
  const CUSTOMER_COLUMNS = ['Namn', 'Organisationsnummer', 'Adress', 'Postnummer', 'Ort', 'Land', 'Kontaktperson', 'E-post', 'Telefon', 'Betalningsvillkor (dagar)', 'Anteckning', 'Arkiverad'];
  function customersCsv(customers) {
    const list = (customers || []).slice().sort((a, b) => String(a.namn || '').localeCompare(String(b.namn || ''), 'sv'));
    const rows = [CUSTOMER_COLUMNS, ...list.map((c) => [c.namn, c.orgnr, c.adress, c.postnr, c.ort, c.land, c.kontakt, c.epost, c.telefon, c.villkor == null || c.villkor === '' ? '' : c.villkor, c.anteckning, c.archived ? 'ja' : 'nej'])];
    return BOM + rows.map(csvRow).join('\r\n');
  }

  // ---------- Nedladdning och delning ----------
  const guessType = (name) => (/\.csv$/i.test(name) ? 'text/csv;charset=utf-8' : /\.json$/i.test(name) ? 'application/json' : /\.pdf$/i.test(name) ? 'application/pdf' : 'text/plain;charset=utf-8');
  // Delningsmenyn på pekskärm (Spara i Filer, Mail, Skriv ut), annars vanlig nedladdning.
  // Ger 'shared', 'downloaded' eller 'cancelled'. Kastar Error i förhandsvisningen på claude.ai.
  async function deliverFile(blob, filename) {
    if (IN_PREVIEW) throw new Error(`Nedladdning fungerar i fakturaappen på ${PUBLIC_URL}, inte i förhandsvisningen.`);
    if (!hasDom) throw new Error('Nedladdning kräver en webbläsare.');
    const name = String(filename || 'fil'); const type = blob.type || guessType(name);
    if (isTouch() && navigator.canShare && typeof File === 'function') {
      const file = new File([blob], name, { type });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return 'shared'; }
        catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; /* annars laddas filen ner nedan */ }
      }
    }
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
  }
  function downloadText(filename, text, mime) {
    return deliverFile(new Blob([text], { type: mime || guessType(filename) }), filename);
  }

  const api = {
    APP, BACKUP_VERSION, SCRIPT_VERSION, IN_PREVIEW, PREVIEW_MSG, LOGO_URL, PUBLIC_URL, SCRIPT_UPDATE_HELP, INVOICE_COLUMNS, CUSTOMER_COLUMNS,
    esc, backupObject, stateFromBackup, readBackupFile, downloadBackup,
    driveConfigured, driveUrlProblem, scriptText, ping, resetPing, uploadBackup, fetchBackup, sendMail,
    mailParts, mailtoUrl, invoicesCsv, customersCsv, downloadText, deliverFile, blobToBase64, friendlyError
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FakturaSync = api;
})(typeof self !== 'undefined' ? self : this);
