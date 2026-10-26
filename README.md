# lil'bakery Faktura

Fakturaprogram för lil'bakery. Här skapar du fakturor, sparar kunder och ser
vilka fakturor som är obetalda. Appen ersätter den gamla Excel-mallen och ser
ut som kassan. Den fungerar på dator, iPad och telefon, i webbläsaren eller
installerad som app på hemskärmen, och fungerar utan internet när den väl har
laddats en gång. All data sparas på enheten. Ingenting skickas någon annanstans
utom till ditt eget Google-konto om du kopplar Google Drive.

## Filer

```
faktura/
  index.html              Hela appen (gränssnitt och logik)
  manifest.webmanifest    Gör att appen kan installeras på hemskärmen
  sw.js                   Service worker: appen fungerar utan internet
  calc.js                 Belopp, moms, datum och fakturanummer
  pdf.js                  Skapar fakturan som PDF
  sync.js                 Säkerhetskopior, Google Drive, e-post och CSV
  import.js               Läser gamla fakturor från Excel-mallen
  vendor/                 jsPDF (PDF), JSZip (Excel) och typsnitt
  img/, icons/            Logga, bilder och appikoner
  serve.bat               Startar appen på datorn för test i det lokala nätverket
  tests/                  Tester, behövs inte för att använda appen
  CONTRACT.md             Teknisk beskrivning för den som bygger vidare
```

Mappen `Resources/` med gamla Excel-fakturor innehåller riktiga kunduppgifter.
Den ska inte publiceras (den är undantagen i `.gitignore`).

## Starta på datorn

Dubbelklicka på `serve.bat` (kräver att `.venv` finns i projektmappen, annars
Python på datorn). Appen öppnas på <http://localhost:8792/>. Adressen som visas
i fönstret går att öppna på iPad och telefon i samma wifi. Kassan använder port
8765, så båda kan vara igång samtidigt.

## Första gången

1. **Importera dina gamla Excel-fakturor** (rekommenderas). Välj *Importera från
   Excel* och markera en eller flera `.xlsx`-filer från den gamla mallen. Appen
   läser dina företagsuppgifter från sidfoten, kunderna och artiklarna, och
   föreslår nästa fakturanummer så att serien fortsätter: var den senaste
   Excel-fakturan nummer 106 blir nästa faktura 107. Kontrollera uppgifterna
   innan du sparar. Gamla filer i formatet `.xls` behöver först sparas om som
   `.xlsx` i Excel.
2. **Eller fyll i allt själv** under *Inställningar*: företagsnamn, ditt namn,
   organisationsnummer (personnumret för enskild firma), adress, telefon,
   e-post och plusgiro, bankgiro eller Swish. Ange *Nästa fakturanummer* som
   numret efter din senaste Excel-faktura. Fakturanumren måste vara en obruten
   serie.
3. **Momsregistreringsnummer.** Det måste stå på alla fakturor med moms. För en
   enskild firma är det `SE` + personnumrets tio siffror + `01`, till exempel
   `SE` `ÅÅMMDDNNNN` `01`. Appen föreslår numret utifrån organisationsnumret,
   men jämför med registreringsbeviset från Skatteverket (eller *Mina sidor* på
   skatteverket.se) innan du bekräftar det.
4. Kontrollera att *Godkänd för F-skatt* är ikryssad om du har F-skatt.

## Daglig användning

- **Ny faktura.** Välj kund eller lägg till en ny, kontrollera datum och
  leveransdatum och fyll i raderna. Priset kan skrivas in med eller utan moms
  (som i Excel-mallen, där priset inklusive moms stod i den dolda kolumnen).
  Fakturan sparas som *utkast* medan du skriver. Ett utkast har inget nummer,
  kan ändras fritt och kan raderas.
- **Skapa fakturan.** Appen kontrollerar att allt som krävs finns med, ger
  fakturan nästa nummer och låser den. Därefter ändras den inte.
- **Mejla.** Med Google-skriptet kopplat skickas fakturan direkt från ditt
  Google-konto med PDF:en som bilaga. Utan det: *Öppna i Mail* skapar ett mejl i
  enhetens e-postapp, och *Ladda ner PDF* sparar filen så att du kan bifoga den.
  Mejlet ber kunden ange fakturanumret som meddelande vid betalningen.
- **Betald.** Markera fakturan som betald när pengarna har kommit, med
  betaldatum. Obetalda fakturor vars förfallodag har passerat visas som
  förfallna. Markeringen går att ångra.
- **Fel på en faktura?** En skapad faktura raderas eller ändras aldrig. Gör en
  *kreditfaktura* (knappen Kreditera) som tar bort beloppet, och skapa sedan en
  ny, rätt faktura. Enda undantaget: den senast skapade fakturan får låsas upp
  igen så länge den inte är skickad, betald eller krediterad.
- **Export till bokföringen.** Fakturalistan och kundregistret kan sparas som
  CSV-filer som öppnas i Excel eller Numbers.

## Säkerhetskopior

Fakturor, kunder och inställningar ligger i webbläsarens lagring på enheten.
Ta därför kopior:

- **Spara säkerhetskopia** under *Inställningar* laddar ner filen
  `faktura-backup-ÅÅÅÅ-MM-DD.json`. Spara den på datorn eller i molnet.
  *Återställ från kopia* läser in den igen, till exempel på en ny enhet.
  Kassans kopior (`lilbakery-kassa-backup-…`) fungerar inte här, och tvärtom.
- **Google Drive.** Fakturaappen använder samma Google-skript som kassan, men
  skriptet måste vara **version 3**. Kassan fortsätter att fungera precis som
  förut med version 3. Så uppdaterar du, en gång, på datorn:
  1. Öppna fakturaappen, gå till *Inställningar → Google Drive* och fyll i
     **samma** webbappsadress och **samma** nyckel som i kassan.
  2. Tryck *Kopiera skriptet*.
  3. Gå till <https://script.google.com> med samma Google-konto och öppna
     **samma projekt** som kassan använder. Skapa inget nytt projekt.
  4. Markera all kod, ta bort den och klistra in det nya skriptet. Spara med
     Ctrl+S.
  5. Klicka *Distribuera → Hantera distributioner*, pennan, välj
     *Version: Ny version* och klicka *Distribuera*. Adressen är densamma.
  6. Godkänn behörigheterna en gång. Google frågar inte av sig självt när
     skriptet får nya funktioner, som att skicka e-post. Välj funktionen
     **hamtaMapp** i listan bredvid *Kör* överst i skripteditorn och klicka
     *Kör*. Välj ditt konto, *Avancerat*, *Fortsätt till projektet (osäkert)*
     och *Tillåt*.
  7. Tryck *Testa anslutningen* i fakturaappen.

  Tills skriptet är uppdaterat skickar fakturaappen ingenting till Drive, för
  att inte skriva över kassans kopia. Har du inte kopplat kassan till Drive än:
  följ stegen i kassans inställningar (nytt projekt, Webbapp, *Kör som: Jag*,
  *Vem har åtkomst: Alla*), med skriptet från fakturaappen eller kassan, som är
  likadant.

  Kopiorna hamnar i mappen *lil'bakery Kassa → Fakturor* på Drive:
  `faktura-backup-senaste.json`, en kopia per dag och en PDF av varje faktura
  när den skapas. *Hämta senaste kopian* läser tillbaka kopian till en annan
  enhet.

Installera appen på hemskärmen på iPad. Då rensar Safari inte lagringen efter en
tids inaktivitet, vilket kan hända för vanliga webbsidor.

## Spara fakturorna i sju år

Enligt bokföringslagen ska fakturor och annan räkenskapsinformation sparas till
och med det sjunde året efter utgången av det kalenderår då räkenskapsåret
avslutades. En faktura från 2026 sparas alltså till och med 2033. Lita inte
bara på enheten: spara PDF:erna (de hamnar automatiskt i mappen *Fakturor* på
Drive), ta säkerhetskopior och exportera CSV till bokföringen. Radera inte gamla
fakturor ur appen.

## Moms på livsmedel

Momsen på livsmedel är tillfälligt sänkt från 12 % till 6 % från 1 april 2026
till och med 31 december 2027. Appen föreslår därför 6 % på nya rader för
fakturor daterade till och med 2027-12-31 och 12 % efter det. Datumet och
satserna finns under *Inställningar* om reglerna ändras. Annat än livsmedel,
till exempel uthyrning, kan ha 25 %. Fråga Skatteverket om du är osäker.

## Publicera på GitHub Pages

Appen behöver en riktig https-adress för att fungera utan internet och kunna
installeras på hemskärmen. Gör som med kassan, men i ett eget repository:

1. Skapa ett nytt repository på <https://github.com> med namnet
   `lilbakery-faktura`.
2. Ladda upp innehållet i mappen `faktura/` med alla undermappar, **utom**
   `Resources/`. Med PowerShell, i mappen `faktura`:
   ```
   git init
   git add .
   git commit -m "lil'bakery Faktura"
   git branch -M main
   git remote add origin https://github.com/okiazee/lilbakery-faktura.git
   git push -u origin main
   ```
   `.gitignore` ser till att `Resources/` inte följer med.
3. Gå till *Settings → Pages*, välj *Deploy from a branch*, gren `main`, mapp
   `/ (root)`, och spara.
4. Efter någon minut finns appen på <https://okiazee.github.io/lilbakery-faktura/>.

Webbsidan är offentlig, men den innehåller inga uppgifter om dig eller dina
kunder. Allt du fyller i stannar på enheten (och på din egen Drive).

## Installera på enheterna

- iPad och iPhone: öppna adressen i Safari, tryck på Dela och välj
  *Lägg till på hemskärmen*.
- Android: öppna i Chrome, tryck på menyn (tre prickar) och välj
  *Installera app*.
- Dator: klicka på installationsikonen i adressfältet i Chrome eller Edge.

## Ny version

När filerna i mappen ändras: ändra `VERSION` i `sw.js` så att installerade
appar hämtar den nya versionen. Testerna körs med
`node --test "tests/*.test.mjs"` i mappen `faktura`.
