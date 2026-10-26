/* Testdata för lil'bakery Faktura. Alla namn, nummer och adresser är påhittade.
   Faktura 107 återskapar Excel-fakturan 106: 34 st Tiramisu Cupcakes à 50 kr inklusive 6 % moms = 1 700,00 kr.
   I webbläsaren: window.FakturaFixture(). I Node: require('./fixture.js')(). Varje anrop ger nya objekt. */
(function (root) {
  'use strict';
  function build() {
    const settings = {
      foretag: "lil'bakery", namn: 'Anna Bagare', orgnr: '850101-1234', momsregnr: 'SE850101123401', momsregBekraftad: true,
      adress: 'Bagargatan 1', postnr: '123 45', ort: 'Stockholm', telefon: '070-000 00 00', epost: 'hej@example.se', webb: '',
      plusgiro: '12345-6', bankgiro: '', swish: '', iban: '', bic: '', fskatt: true,
      drojsmalsranta: 'Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen.',
      fakturaText: 'Tack för beställningen!',
      betalningsvillkor: 14, momsStandard: 6, momsStandardTill: '2027-12-31', momsEfter: 12, prisLage: 'inkl', oresavrundning: false,
      nastaNummer: 107, driveUrl: '', driveKey: '', driveAuto: true
    };
    const kund = { id: 'k1', namn: 'Exempelbolaget AB', orgnr: '556677-8899', adress: 'Exempelvägen 1', postnr: '172 00', ort: 'Sundbyberg', land: '', kontakt: 'Eva Exempel', epost: 'eva@example.se', telefon: '', villkor: 14, anteckning: 'Beställer till fredagsfikat.', created: '2026-05-01T08:00:00.000Z', updated: '2026-05-01T08:00:00.000Z' };
    const kund2 = { id: 'k2', namn: 'Långt Företagsnamn Konsult & Byggprojektledning i Norden Aktiebolag', orgnr: '559900-1122', adress: 'c/o Kontorshotellet, Storgatan 100, våning 7', postnr: '111 22', ort: 'Stockholm', land: '', kontakt: 'Per Persson', epost: 'per@example.se', telefon: '08-000 00 00', villkor: 30, anteckning: '', created: '2026-06-01T08:00:00.000Z', updated: '2026-06-01T08:00:00.000Z' };
    const snap = (c) => ({ namn: c.namn, orgnr: c.orgnr, adress: c.adress, postnr: c.postnr, ort: c.ort, land: c.land, kontakt: c.kontakt, epost: c.epost, telefon: c.telefon });
    const seller = (({ foretag, namn, orgnr, momsregnr, adress, postnr, ort, telefon, epost, webb, plusgiro, bankgiro, swish, iban, bic, fskatt, drojsmalsranta, fakturaText }) => ({ foretag, namn, orgnr, momsregnr, adress, postnr, ort, telefon, epost, webb, plusgiro, bankgiro, swish, iban, bic, fskatt, drojsmalsranta, fakturaText }))(settings);
    const base = { saljare: seller, krediterar: null, krediteradAv: null, totals: null, oresavrundning: false, meddelande: '', history: [], sentAt: null, paidAt: null };

    const f107 = Object.assign({}, base, {
      id: 'f107', typ: 'faktura', status: 'skickad', nr: 107, customerId: 'k1', kund: snap(kund),
      datum: '2026-05-05', leveransdatum: '2026-05-06', villkor: 14, forfallodag: '2026-05-19',
      varRef: 'Anna Bagare', erRef: 'Eva Exempel', markning: '-', priceMode: 'inkl',
      lines: [{ id: 'l1', name: 'Tiramisu Cupcakes', qty: 34, unit: 'st', price: 50, vat: 6 }],
      created: '2026-05-05T08:00:00.000Z', updated: '2026-05-05T08:00:00.000Z', finalizedAt: '2026-05-05T08:00:00.000Z', sentAt: '2026-05-05T09:00:00.000Z'
    });

    // Lång faktura: flera momssatser, priser exklusive moms, textrad, långa namn och sidbrytning.
    const items = [
      ['Tiramisu Cupcakes', 24, 'st', 40, 6], ['Cinnabuns med kardemumma och extra pärlsocker på toppen, glutenfria', 36, 'st', 28.3, 6],
      ['Brownie, klassisk', 40, 'st', 22.5, 6], ['Kaffe, termos 2,5 liter', 3, 'st', 160, 6], ['Leverans till kontoret', 1, 'st', 350, 25],
      ['Uthyrning av tårtfat', 2, 'st', 75, 25], ['Cookies, chocolate chip', 60, 'st', 15, 6], ['Minicakes, citron', 48, 'st', 18.75, 6]
    ];
    const longLines = [];
    for (let i = 0; i < 4; i++) items.forEach(([name, qty, unit, price, vat], j) => longLines.push({ id: `x${i}-${j}`, name: i ? `${name} (omgång ${i + 1})` : name, qty, unit, price, vat }));
    longLines.splice(3, 0, { id: 'txt', name: 'Leverans fredag 8 maj kl. 08:00, ring Per vid ankomst.', qty: '', unit: '', price: null, vat: 6 });
    longLines.push({ id: 'free', name: 'Provsmak, gratis', qty: 10, unit: 'st', price: 0, vat: 6 });
    longLines.push({ id: 'h', name: 'Timdebitering, dekoration', qty: 2.5, unit: 'tim', price: 450, vat: 25 });
    const f108 = Object.assign({}, base, {
      id: 'f108', typ: 'faktura', status: 'klar', nr: 108, customerId: 'k2', kund: snap(kund2),
      datum: '2026-06-10', leveransdatum: '2026-06-08', villkor: 30, forfallodag: '2026-07-10',
      varRef: 'Anna Bagare', erRef: 'Per Persson', markning: 'Projekt 4711 / Kostnadsställe 12', priceMode: 'exkl', oresavrundning: true,
      meddelande: 'Beställningen avser personalfesten den 8 juni. Allergener: innehåller gluten, ägg och mjölk om inget annat anges.',
      lines: longLines,
      created: '2026-06-10T08:00:00.000Z', updated: '2026-06-10T08:00:00.000Z', finalizedAt: '2026-06-10T08:00:00.000Z'
    });

    const k109 = Object.assign({}, base, {
      id: 'k109', typ: 'kredit', status: 'klar', nr: 109, customerId: 'k1', kund: snap(kund),
      datum: '2026-06-12', leveransdatum: '2026-05-06', villkor: 0, forfallodag: '2026-06-12',
      varRef: 'Anna Bagare', erRef: 'Eva Exempel', markning: '-', priceMode: 'inkl',
      meddelande: 'Kreditering av faktura 107.', krediterar: { id: 'f107', nr: 107, datum: '2026-05-05' },
      lines: [{ id: 'c1', name: 'Tiramisu Cupcakes', qty: -34, unit: 'st', price: 50, vat: 6 }],
      created: '2026-06-12T08:00:00.000Z', updated: '2026-06-12T08:00:00.000Z', finalizedAt: '2026-06-12T08:00:00.000Z'
    });
    f107.status = 'krediterad'; f107.krediteradAv = { id: 'k109', nr: 109 };

    const draft = Object.assign({}, base, {
      id: 'd1', typ: 'faktura', status: 'utkast', nr: null, saljare: null, customerId: 'k1', kund: snap(kund),
      datum: '2026-10-26', leveransdatum: '2026-10-30', villkor: 14, forfallodag: '2026-11-09',
      varRef: 'Anna Bagare', erRef: 'Eva Exempel', markning: '', priceMode: 'inkl',
      lines: [{ id: 'd1l', name: 'Cinnabuns', qty: 20, unit: 'st', price: 35, vat: 6 }, { id: 'd1e', name: '', qty: 1, unit: 'st', price: null, vat: 6 }],
      created: '2026-10-26T08:00:00.000Z', updated: '2026-10-26T08:00:00.000Z', finalizedAt: null
    });

    return {
      settings, customers: [kund, kund2], invoices: [f107, f108, k109, draft],
      state: { version: 1, settings, customers: [kund, kund2], invoices: [f107, f108, k109, draft], meta: { onboarded: true } },
      // Förväntade summor för testerna.
      expected: { f107: { rows: [{ rate: 6, net: 1603.77, vat: 96.23, gross: 1700 }], net: 1603.77, vat: 96.23, gross: 1700, toPay: 1700 } }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = build;
  else root.FakturaFixture = build;
})(typeof self !== 'undefined' ? self : this);
