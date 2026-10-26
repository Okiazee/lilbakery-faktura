# lil'bakery Faktura – kontrakt för bygget

Kontraktet styr hur delarna passar ihop. Avvik inte från namn, fält eller signaturer utan att säga
det i din slutrapport.

## Vad appen är

En PWA för att skapa fakturor, spara kunder och hålla koll på obetalda fakturor åt lil'bakery
(enskild firma, bageri). Den ersätter en Excel-mall (Isolta, `Faktura/Resources/Faktura 106.xlsx`).
Användaren är inte tekniker, skriver svenska och fakturerar mest vid datorn, ibland från iPad/telefon.
Syskonappen är kassan i `../kassa/` (samma utseende, samma teknik, samma Google Apps Script).

- Vanilla JS, ingen byggprocess, inga npm-beroenden i appen. Allt UI på svenska.
- Data i `localStorage` under nyckeln `lilbakery.faktura.v1`. JSON-backup och Google Drive-backup.
- Körs lokalt via `serve.bat` (port 8792) och senare på GitHub Pages
  (`https://okiazee.github.io/lilbakery-faktura/`, finns inte än).
- **Inga personuppgifter i källkoden.** Användarens personnummer, adress, telefon och e-post får inte
  stå i någon fil. Standardinställningarna är tomma; användaren fyller i dem eller importerar sin
  gamla Excel-faktura. Testdata i `tests/fixture.js` är påhittad.

## Filer och ägare

| Fil | Ägare | Innehåll |
|---|---|---|
| `calc.js` | lead (klar) | `window.FakturaCalc`: belopp, moms, avrundning, datum, status, numrering, nya/kopierade/krediterade utkast, kontroll före låsning |
| `tests/fixture.js` | lead (klar) | `window.FakturaFixture()`: inställningar, 2 kunder, fakturor 107 (= Excel 106), 108 (lång, flera momssatser, sidbrytning), kreditfaktura 109, ett utkast |
| `index.html` | Agent A | CSS, skal, state, alla vyer och dialoger |
| `manifest.webmanifest`, `img/`, `icons/` | Agent A | kopieras från `../kassa/` (logo.png, cupcake.png, wordmark.png, ikoner) |
| `pdf.js` | Agent B | `window.FakturaPdf` |
| `vendor/jspdf.umd.min.js`, `vendor/fonts/*` | Agent B | kopieras från `../kassa/vendor/` |
| `tests/calc.test.mjs`, `tests/pdf-render.mjs`, `tests/preview.html` | Agent B | tester och förhandsvisning |
| `sync.js` | Agent C | `window.FakturaSync`: backup, Google Drive, mejl, CSV, dela/ladda ner |
| `import.js`, `vendor/jszip.min.js` | Agent C | `window.FakturaImport`: läser gamla Excel-fakturor (Isolta-mallen) |
| `sw.js`, `serve.bat`, `README.md`, `.gitignore` | Agent C | service worker, lokal server, instruktioner |
| `tests/sync.test.mjs`, `tests/import.test.mjs` | Agent C | tester |
| `../kassa/index.html` (bara `driveScriptText` + versionskonstanter), `../kassa/sw.js` (VERSION) | Agent C | kassan visar samma Apps Script version 3 |

Rör inte filer du inte äger. Behöver du något från en annan del: anta signaturen nedan och skriv det i rapporten.

Skriptordning i `index.html`:
```html
<script src="calc.js"></script>
<script src="pdf.js"></script>
<script src="sync.js"></script>
<script src="import.js"></script>
<script> /* appen */ </script>
```
`pdf.js` och `import.js` laddar sina tunga bibliotek (`vendor/jspdf.umd.min.js`, `vendor/jszip.min.js`)
först när de behövs.

## State

```js
state = {
  version: 1,
  settings: Settings,
  customers: Customer[],
  invoices: Invoice[],
  items: Item[],          // inlärda artiklar för autokomplettering av rader
  meta: { onboarded: false, driveLastOk: null, driveLastError: '', drivePending: false,
          lastBackupDownload: null }
}
```

### Settings (standardvärden)
```js
{
  foretag: "lil'bakery", namn: '', orgnr: '', momsregnr: '', momsregBekraftad: false,
  adress: '', postnr: '', ort: '', telefon: '', epost: '', webb: '',
  plusgiro: '', bankgiro: '', swish: '', iban: '', bic: '',
  fskatt: true,
  drojsmalsranta: 'Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen.',
  fakturaText: 'Tack för beställningen!',
  betalningsvillkor: 14,             // dagar netto, standard för nya kunder
  momsStandard: 6, momsStandardTill: '2027-12-31', momsEfter: 12,
  prisLage: 'inkl',                  // 'inkl' | 'exkl' – hur priser skrivs in på nya fakturor
  oresavrundning: false,
  nastaNummer: 1,                    // användaren anger vid start (gamla Excel-serien fortsätter)
  driveUrl: '', driveKey: '', driveAuto: true
}
```
`nastaNummer` går bara att ändra så länge ingen faktura har låsts med ett lägre nummer
(`FakturaCalc.nextNumber` tar alltid max av inställningen och högsta använda + 1).
`momsregnr` föreslås med `FakturaCalc.suggestMomsregnr(orgnr)` men användaren bekräftar
(`momsregBekraftad`).

### Customer
```js
{ id, namn, orgnr, adress, postnr, ort, land, kontakt, epost, telefon,
  villkor,        // dagar netto, null = använd settings.betalningsvillkor
  anteckning, created, updated }
```
`kontakt` blir *Er referens* på nya fakturor. En kund med fakturor kan inte raderas (bara arkiveras:
`archived: true`).

### Invoice
```js
{
  id, typ: 'faktura' | 'kredit',
  status: 'utkast' | 'klar' | 'skickad' | 'betald' | 'krediterad',  // 'forfallen' räknas fram
  nr: null | number,                 // delas ut vid låsning
  customerId, kund: CustomerSnapshot, // kopia av kunden, fryses vid låsning
  saljare: null | SellerSnapshot,    // FakturaCalc.sellerSnapshot(settings) vid låsning
  datum, leveransdatum, villkor, forfallodag,   // 'ÅÅÅÅ-MM-DD', villkor i dagar
  varRef, erRef, markning,           // Vår referens = ägaren, Er referens = kundens kontakt
  priceMode: 'inkl' | 'exkl',        // gäller hela fakturan
  oresavrundning: boolean,
  lines: [{ id, name, qty, unit, price, vat }],  // price per enhet enligt priceMode, vat i procent
  meddelande: '',                    // fritext under raderna
  krediterar: null | { id, nr, datum },   // på en kreditfaktura
  krediteradAv: null | { id, nr },        // på originalet
  totals: null | Totals,             // FakturaCalc.totals(invoice) sparas vid låsning
  created, updated, finalizedAt, sentAt, paidAt,   // paidAt = 'ÅÅÅÅ-MM-DD'
  history: [{ ts, text }]            // "Skapad", "Mejlad till x", "Markerad betald" …
}
```

Livscykel:
1. **Utkast** – fritt redigerbart, kan raderas, inget nummer. Förhandsvisning som PDF med vattenstämpeln UTKAST.
2. **Lås och skapa** – kör `FakturaCalc.validate(inv, sellerSnapshot)`. Fel stoppar, varningar bekräftas.
   Tomma rader (`FakturaCalc.isEmptyLine`) tas bort. Sätter `nr = FakturaCalc.nextNumber(state)`,
   `saljare`, fryser `kund`, sparar `totals`, `status = 'klar'`, `finalizedAt`. Lär in raderna i `state.items`.
   Startar Drive-backup direkt (inte fördröjd) med fakturans PDF.
3. **Klar → Skickad** när den mejlas, delas eller laddas ner och användaren bekräftar att den skickats
   (eller med knappen *Markera som skickad*).
4. **Betald** med betaldatum (standard i dag). Går att ångra.
5. **Kreditera** – `FakturaCalc.creditFor(inv, settings)` ger ett utkast till kreditfaktura som låses
   som vanligt (nästa nummer i samma serie). När den låses: originalet får `status = 'krediterad'`
   och `krediteradAv`.
6. En låst faktura ändras aldrig. Undantag: den senaste låsta fakturan, om den inte är skickad, betald
   eller krediterad, får *låsas upp* till utkast igen (numret släpps). Allt annat rättas med kreditfaktura.
7. *Kopiera* = `FakturaCalc.copyInvoice(inv, settings)` → nytt utkast.

### Item (inlärd artikel)
```js
{ id, name, unit, price, priceMode, vat, lastUsed }   // unik på name (skiftlägesokänsligt), senaste pris vinner
```

## Räkneregler (finns i calc.js – räkna aldrig själv)

- `FakturaCalc.totals(inv)` → `{ mode, lines[], rows[{rate, net, vat, gross}], net, vat, gross, rounding, toPay, count }`.
  `lines[i]` har samma index som `inv.lines` och innehåller `unitExkl`, `unitInkl`, `net`, `gross`, `text`.
- Visa alltid á-pris och radbelopp **exklusive moms** med 2 decimaler på fakturan (lagkrav), även när
  priset skrivs in inklusive moms. Momsspecifikationen per sats kommer från `rows`.
- Öresavrundning är av som standard och visas som egen rad när den används.
- Belopp formateras med `FakturaCalc.money(n)` / `FakturaCalc.kr(n)`, antal med `FakturaCalc.num(n)`,
  datum skrivs som `ÅÅÅÅ-MM-DD`.

## API mellan delarna

### FakturaPdf (pdf.js, Agent B)
```js
FakturaPdf.render(invoice, { seller, base = '' }) → Promise<Blob>
  // seller används när invoice.saljare är null (utkast). base = sökväg till appens rot ('' eller '../').
  // Utkast får vattenstämpeln UTKAST. Kreditfaktura heter "Kreditfaktura" och visar "Avser faktura N".
FakturaPdf.draw(doc, invoice, seller, assets)   // ren ritfunktion, går att köra i Node med jsPDF
FakturaPdf.loadAssets(base) → Promise<{ logo: {data, ratio} | null, fonts: {...} | null }>
FakturaPdf.filename(invoice)                    // = FakturaCalc.filename
```

### FakturaSync (sync.js, Agent C)
Alla funktioner tar in det de behöver; inget globalt state.
```js
FakturaSync.IN_PREVIEW                       // true på claude.ai, där Google inte nås
FakturaSync.LOGO_URL                         // 'https://okiazee.github.io/lilbakery-kassa/img/logo.png' (mejlets logga)
FakturaSync.backupObject(state) → object     // { app: 'lilbakery-faktura', version, exportedAt, state }
FakturaSync.downloadBackup(state)            // laddar ner faktura-backup-ÅÅÅÅ-MM-DD.json
FakturaSync.readBackupFile(file) → Promise<state>   // validerar, kastar Error med svensk text
FakturaSync.driveUrlProblem(url) → '' | text
FakturaSync.scriptText(key) → string         // Apps Script version 3 (se nedan)
FakturaSync.ping(settings) → Promise<{ ok, version, mail }>
FakturaSync.uploadBackup(state, { pdf: Blob?, pdfName? }) → Promise<{ ok, saved }>
  // kräver ping().version >= 3, annars Error('Skriptet behöver uppdateras till version 3 …')
FakturaSync.fetchBackup(settings) → Promise<{ updated, state }>
FakturaSync.sendMail(settings, { to, subject, text, html, pdf: Blob, filename }) → Promise<{ ok, sent }>
FakturaSync.mailParts(invoice, seller) → { subject, text, html }   // svensk text + varumärkt HTML-mejl
FakturaSync.mailtoUrl(invoice, seller, to) → string
FakturaSync.invoicesCsv(invoices) → string  // låsta fakturor, en rad per faktura (se nedan)
FakturaSync.customersCsv(customers) → string
FakturaSync.downloadText(filename, text, mime)
FakturaSync.deliverFile(blob, filename)      // delningsmenyn på pekskärm, annars nedladdning
FakturaSync.friendlyError(err) → string
```
CSV: semikolon, UTF-8 med BOM, decimalkomma. Kolumner: `Nummer;Typ;Fakturadatum;Leveransdatum;Förfallodag;
Betaldatum;Status;Kund;Kundens orgnr;Netto 25 %;Moms 25 %;Netto 12 %;Moms 12 %;Netto 6 %;Moms 6 %;
Netto 0 %;Öresavrundning;Att betala`.

### FakturaImport (import.js, Agent C)
```js
FakturaImport.readFiles(FileList | File[]) → Promise<{
  seller: Partial<Settings>,     // från sidfoten i senaste filen: foretag, adress, postnr, ort, telefon, epost, orgnr, plusgiro, bankgiro, fskatt
  customers: Partial<Customer>[],// unika på orgnr eller namn
  items: Item[],                 // radernas namn, enhet, pris inkl. moms, moms
  invoices: { file, nr, datum, leveransdatum, villkor, varRef, erRef, markning, kund, lines, priceMode }[],
  maxNr: number | null,          // högsta fakturanummer → förslag nastaNummer = maxNr + 1
  warnings: string[]
}>
```
Isolta-mallens celler (blad 1): E3 företag, L4 fakturanummer, L5 datum (Excel-serietal), E9 leveransdatum,
E10 villkor ("14 dgr netto"), E11/E12 referenser (ofta omkastade: den som matchar kundens e-post är
kundens kontakt), E13 märkning, J9 kundnamn, J10 kundens orgnr, J11 gatuadress, J12 postnr + ort,
J13 kundens e-post, rader 20–39: C namn, H antal, I enhet, S pris inkl. moms (dold hjälpkolumn, om
ifylld), annars J á-pris exkl. moms, K moms (0.06 = 6 %). Sidfot: C53 företag, C54 adress, C55 postnr + ort,
E53 "Tel: …", E54 "Mail: …", L53 orgnr, J54 "Godkänd för F-skatt", L51/L52 betalsätt + nummer (Plusgiro).

## Apps Script version 3 (delas med kassan)

Samma webbapp och nyckel som kassan. Version 3 är bakåtkompatibel med kassans version 2:
- `POST` utan `action` och utan `app` → kassans backup som i dag (`kassa-backup-*.json`, dagsavslut-CSV).
- `POST { action: 'mail', to, subject, text, html, pdf, filename, from }` → MailApp, som i dag.
- `POST { app: 'faktura', backup, pdf?, pdfName? }` → undermappen `Fakturor` i `lil'bakery Kassa`:
  `faktura-backup-senaste.json`, `faktura-backup-ÅÅÅÅ-MM-DD.json` och, om `pdf` finns, PDF-filen `pdfName`.
- `GET ?action=ping` → `{ ok: true, mail: true, version: 3, faktura: true }`.
- `GET ?app=faktura` → senaste fakturabackupen.

Fakturaappen skickar aldrig en backup till ett skript som svarar version < 3 (då skulle kassans backup
skrivas över). Inställningarna visar tydligt när skriptet behöver uppdateras, med samma steg som kassan.

## Fakturans innehåll (PDF, A4)

Lagkrav enligt mervärdesskattelagen som alltid ska finnas: fakturadatum, löpnummer, säljarens
momsregistreringsnummer, säljarens och köparens namn och adress, varornas mängd och art,
leveransdatum, beskattningsunderlag per momssats, momssats och momsbelopp, samt "Godkänd för F-skatt".
Betalningsreferens skrivs som "Ange fakturanummer N som meddelande" (det är inget OCR-nummer).

## Utseende

Samma uttryck som kassan: kopiera CSS-variablerna i `../kassa/index.html` (`:root`, ljust tema,
Nunito från Google Fonts, Sacramento för hälsningen, pastellblått `#a9d3d6`/`#3b7a80`, rosa `#f3a6b4`).
PDF-färger som kassans `COL` (`ink [47,74,77]`, `muted [109,134,136]`, `brand [59,122,128]`,
`pink [196,83,106]`, `line [217,233,234]`, `mist [243,248,248]`).
Kommentarer i koden på svenska, korta, i kassans stil.
