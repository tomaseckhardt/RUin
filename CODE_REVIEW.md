# Code review – RUin

Datum: 2026-07-30
Metoda: automatizovaný multi-agent review přes 12 tematických oblastí (RLS/autorizace, RPC logika, edge funkce, frontend lib, jednotlivé stránky, komponenty, accessibility, testy/CI, build shell). Každý nález se závažností medium a výš byl nezávisle ověřen druhým agentem, který se ho aktivně snažil vyvrátit.

Výsledek: 91 nahlášených nálezů → **40 potvrzených** (critical/high/medium), **2 vyvrácené**, **48 nízké závažnosti** (drobnosti, postoupily bez samostatného ověřovacího kroku).

Recenzovaný stav: aktuální obsah souborů na disku ke dni reviewu (větev `refactoringBranch`), včetně needitovaných změn.

---

## Obsah

1. [Kritické](#kritické)
2. [Vysoká závažnost](#vysoká-závažnost)
3. [Střední závažnost](#střední-závažnost)
4. [Nízká závažnost / drobnosti](#nízká-závažnost--drobnosti)
5. [Vyvrácené nálezy](#vyvrácené-nálezy)
6. [Doporučené pořadí oprav](#doporučené-pořadí-oprav)

---

## Kritické

### 1. Únik tajného tokenu ankety (`event_polls`)
**`supabase/sql/all-phases.sql:2818`**

RLS politika `event_polls_select` má `USING (true)`, takže tabulka `event_polls` (včetně sloupce `creator_token`, uloženého jako plaintext) je čitelná pro kohokoli s veřejným anon klíčem – na rozdíl od `events.organizer_token`, který má explicitně `USING (false)` a je chráněn výhradně přes SECURITY DEFINER RPC.

**Scénář selhání:** Útočník pošle přímý REST dotaz (`.../rest/v1/event_polls?select=id,creator_token`) s veřejným anon klíčem a získá `creator_token` libovolné, i cizí ankety, aniž by kdy navštívil její odkaz. S tímto tokenem zavolá `finalize_event_poll` s vlastním `organizer_pin` dřív než skutečný tvůrce, čímž se stane organizátorem nově vzniklé akce a zablokuje legitimnímu tvůrci možnost anketu sám vyhodnotit.

**Doporučení:** Zablokovat přímý SELECT nad `creator_token` stejně jako u `events` (`USING (false)` + přístup jen přes `get_poll_payload`/`finalize_event_poll`), případně token přesunout do samostatné tabulky bez veřejné SELECT politiky.

---

### 2. „Smazané“ fotky zůstávají navždy veřejně dostupné
**`supabase/sql/all-phases.sql:3050`**, **`client/src/components/PhotoGallery.jsx:86`**

Pro `storage.objects`/bucket `event-photos` existuje jen INSERT a SELECT RLS politika – žádná DELETE. `handleDelete` v `PhotoGallery.jsx` volá `storage.remove()` s anon klíčem, RLS to zamítne, kód to ošetří jen jako tiché varování a smaže se pouze DB řádek. Soubor zůstává trvale stažitelný na své (byť neuhodnutelné) veřejné URL – bucket je `public: true`.

**Scénář selhání:** Organizátor smaže nevhodnou/soukromou fotku. UI ukáže úspěch, ale fotka je fyzicky pořád v bucketu a dostupná komukoli, kdo zná/uhodne/cachoval URL, až do 7denní expirace celé akce (řešeno až Edge Function se service-role klíčem).

**Křížová vazba:** Stejný kořenový problém potvrzuje i vyvrácený nález u `delete_event` (viz [Vyvrácené nálezy](#vyvrácené-nálezy)) – manuální mazání akce v `ManageEventPage.jsx` sice *volá* `storage.remove()`, ale ze stejného důvodu (chybějící DELETE politika) pravděpodobně také nefunguje.

**Doporučení:** Přidat DELETE RLS politiku vázanou na `organizer_token` (např. přes `storage.foldername` + ověření proti `events.organizer_token`), nebo mazání souborů přesunout do Edge Function se service-role klíčem volané z `delete_event_photo`.

---

### 3. CI nekontroluje vůbec nic před nasazením
**`.github/workflows/deploy-pages.yml:3`**

Jediný workflow v repozitáři reaguje jen na `push` do `main` a `workflow_dispatch` – žádný `pull_request` trigger. Build job dělá jen checkout → install → `npm run build` → deploy. Nikde se nevolá `npm test`, `npm run lint`, `npm run test:a11y` ani `npm run audit:a11y`, přestože všechny tyto skripty existují.

**Scénář selhání:** PR s rozbitým RSVP formulářem nebo lint chybou nemá žádný automatický check, projde jen lidským review, po mergi do `main` se rovnou nasadí na produkční GitHub Pages bez jakékoli automatické kontroly.

**Doporučení:** Přidat `pull_request` trigger se samostatným CI jobem (lint + test + build) jako povinný check před mergem; do `deploy-pages.yml` vložit `npm run lint` a `npm test` před `npm run build`.

---

### 4. Testy se reálně vůbec nespouští
**`client/jest.config.js:7`**

`transform: {}` explicitně vypíná defaultní babel-jest transform. Bez vlastního `babel.config.js`/`.babelrc` selžou všechny 3 test soubory hned na `import` syntaxi v `src/test/setup.js` (`SyntaxError: Cannot use import statement outside a module`).

**Ověřeno reprodukcí:** Spuštění `npm test` (na kopii bez zvláštních znaků v cestě) skutečně skončí s `Test Suites: 3 failed, 3 total; Tests: 0 total`.

**Doporučení:** Odstranit `transform: {}` (ať se použije default babel-jest), nebo nakonfigurovat explicitní transformer (babel-jest + `@babel/preset-react`, nebo `@swc/jest`) a ověřit, že `npm test` skutečně proběhne s nenulovým počtem testů.

---

## Vysoká závažnost

### 5. RLS nevynucuje `event_id` na řadě tabulek
**`supabase/sql/all-phases.sql:1031`** (a `event_signup_items_select:2553`, `event_signup_claims_select:2560`, `event_stops_select:2716`, `event_poll_options_select:2823`, `event_poll_votes_select:2828`, `event_photos_select:3044`, `event_chat_message_reactions_select:2460`, `event_realtime_ticks_select_allowed:1479`)

SELECT politiky na těchto tabulkách jsou buď doslovně `USING (true)`, nebo `USING (event_exists(event_id))`, což je díky FK+cascade triviálně pravdivé pro každý existující řádek. Klientský `.eq('event_id', eventId)` filtr v `client/src/lib/api.js` je čistě dobrovolný, DB ho nevynucuje.

**Scénář selhání:** `curl '.../rest/v1/event_chat_messages?select=*'` s veřejným anon klíčem bez filtru vrátí chat zprávy ze VŠECH akcí v aplikaci najednou. Stejně tak lze vytáhnout jména řidičů/spolujezdců, itinerář, ankety a fotky napříč celou aplikací.

**Doporučení:** Nahradit tyto politiky skutečným omezením na konkrétní `event_id`, nebo číst výhradně přes parametrizované SECURITY DEFINER RPC (`get_event_payload`), jak už je to řešeno u `push_subscriptions`/`event_reminders_sent`.

---

### 6. Edge Function `send-event-reminders` bez autentizace
**`supabase/functions/send-event-reminders/index.ts:110`**

`Deno.serve(async () => {...})` vůbec nečte request/hlavičky. Funkce je nasazena s `--no-verify-jwt`. `SUPABASE_URL` (a tedy project ref) je veřejně vidět ve frontend bundlu, takže URL funkce si odvodí kdokoli.

**Scénář selhání:** Útočník opakovaně a souběžně volá funkci mimo plánovaný cron, což ve spojení s race condition (viz níže) vede k reálnému rozeslání duplicitních push notifikací všem odběratelům.

**Doporučení:** Přidat kontrolu sdíleného tajemství (hlavička porovnávaná s hodnotou z env proměnné) na začátek handleru, s 401 při neshodě.

---

### 7. `unclaim_signup_item` neověřuje vlastnictví
**`supabase/sql/all-phases.sql:2650`**

Funkce maže z `event_signup_claims` podle `lower(attendee_name) = lower(p_attendee_name)` bez ověření, že volající je skutečně ten účastník. `p_attendee_name` je čistě klientský string, funkce je `security definer` s grantem pro `anon`.

**Scénář selhání:** Kdokoli se znalostí veřejně viditelného jména jiného účastníka (viditelné přímo v `SignupBoard`) může přes devtools/konzoli zavolat RPC a odhlásit ho z bring-listu/spolujízdy bez jeho vědomí. Sesterská funkce `remove_signup_claim` stejnou kontrolu (vlastnictví nabídky) má – zde na ni autoři zapomněli.

**Doporučení:** Přidat ověření, že volající prokazatelně je daný účastník (nebo držitel `organizer_token`), analogicky k `remove_signup_claim`.

---

### 8. Upload fotek bez server-side validace typu/velikosti
**`client/src/lib/api.js:360`**

`uploadEventPhoto` volá `storage.upload()` bez žádné validace. Bucket `event-photos` nemá nastavený `file_size_limit` ani `allowed_mime_types`. Jediná kontrola (`file.type.startsWith('image/')`) je klientská, v `PhotoGallery.jsx:67`, a triviálně obejitelná přímým voláním JS SDK s veřejným anon klíčem.

*Potvrzeno nezávisle dvěma reviewery (lib-layer i components-social).*

**Scénář selhání:** Útočník nahraje libovolně velký nebo libovolného typu soubor do veřejného bucketu pod libovolný `event_id` – volný veřejný file-hosting, riziko nákladů/zneužití.

**Doporučení:** Nastavit `file_size_limit`/`allowed_mime_types` přímo na bucketu (Supabase to podporuje) a případně validovat i v `record_event_photo` jako druhou vrstvu.

---

### 9. Identita session se neresetuje při přechodu mezi akcemi
**`client/src/pages/EventPage.jsx:112`**

Aplikace používá `HashRouter` (invite odkazy `#/event/:id`). `name`/`sessionName`/`isIdentityLocked` se inicializují jen jednou přes `useState` lazy inicializér – React Router nedělá remount komponenty jen kvůli změně URL parametru u stejné route.

**Scénář selhání:** Přechod mezi dvěma invite odkazy ve stejné záložce ponechá identitu ze staré akce. `sessionAttendee` v novém eventu nenajde shodu, uživatel vidí „Jsi přihlášený“/„Načítám tvůj aktuální stav…“ navždy, dokud neklikne na „Nejsem to já“.

**Doporučení:** Resetovat identity-related state v efektu sledujícím `id`, nebo vynutit remount přes `key={id}` na `<Route element>`.

---

### 10. Identita „organizátora“ se hádá z pořadí v poli
**`client/src/pages/ManageEventPage.jsx:540`**

`const organizerName = attendees[0]?.name || ''` – nic neoznačuje organizátora jako takového v datech (žádný `is_organizer` sloupec). Smazání vlastního řádku organizátorem přepočítá `attendees[0]` na jiného účastníka.

**Scénář selhání:** Organizátor omylem smaže svůj vlastní řádek v seznamu účastníků (nic mu v tom nebrání). `organizerName` se tiše stane jménem jiné osoby – další zprávy v chatu, šťouchnutí, přihlášení do bring-listu i nahrané fotky „jako organizátor“ se pak ukládají pod cizím jménem.

**Doporučení:** Vracet jméno organizátora jako samostatné pole z `get_event_payload` (uložené už při `create_event`), místo odvozování z pořadí.

---

### 11. Modály ve správě akce bez focus trapu/Escape/ARIA
**`client/src/pages/ManageEventPage.jsx:700`**

Čtyři modály (šťouchnutí, úprava akce, odemčení PINem, přehled) jsou ručně psané `<section className="fixed inset-0...">` místo existující komponenty `ModalOverlay`, která toto všechno řeší (a je použita v `EventPage.jsx`).

**Scénář selhání:** Uživatel na klávesnici otevře modál – fokus se nikam nepřesune, Tab propadne do obsahu pod modálem, Escape nezavře nic, čtečka obrazovky neohlásí, že se otevřel dialog.

**Doporučení:** Nahradit všechny čtyři bloky komponentou `ModalOverlay`.

---

### 12. Lightbox fotogalerie – stejný problém
**`client/src/components/PhotoGallery.jsx:203`**

Lightbox nemá `role="dialog"`/`aria-modal`, focus trap ani návrat fokusu; klávesový handler reaguje jen na šipky, ne na Escape.

**Doporučení:** Obalit stejnou komponentou `ModalOverlay` jako jinde v appce.

---

### 13. `npm run dev` rozbíjí HMR úplně
**`client/scripts/run-vite-safe.mjs:26`**

Skript zkopíruje celý `client/` do dočasného adresáře v `/tmp` (`fs.cpSync`) a teprve tam spustí `vite dev`. Vite watcher sleduje soubory v `/tmp`, ne v reálném pracovním stromu – synchronizace zpět běží jen pro `build`, nikdy pro `dev`.

**Scénář selhání:** Vývojář upraví zdrojový soubor, uloží – Vite žádnou změnu nezaznamená. HMR/live reload při vývoji vůbec nefunguje, nutný je ruční restart `npm run dev` po každé změně.

**Doporučení:** Spouštět Vite přímo v `clientRoot` a problém se speciálními znaky v cestě (`Are you in?`) řešit jinak (např. symlink), nebo implementovat obousměrnou synchronizaci.

---

### 14. Žádné testy pro klíčovou byznys logiku
**`client/src`** (obecně)

Existují pouze 3 testovací soubory a všechny se týkají jen přístupnosti dvou komponent. `api.js`, `SignupBoard.jsx`, `PollPage.jsx`, `EventPage.jsx`, `ManageEventPage.jsx` – tedy RSVP, claim/unclaim, hlasování, organizátorské akce vázané na token – nemají ani jeden test.

**Doporučení:** Doplnit jednotkové testy pro `lib/api.js` (mockovaný Supabase klient) a integrační testy pro `SignupBoard`, `PollPage`, `EventPage`, `ManageEventPage` – šťastná cesta i hraniční stavy (dvojitý claim, hlasování po uzavření ankety, RSVP bez tokenu).

---

## Střední závažnost

### SQL – data integrita

- **`update_event` nemaže `event_reminders_sent`** ([`:1906`](supabase/sql/all-phases.sql#L1906)) – posun termínu akce tiše zablokuje budoucí push připomínky pro nový čas, protože řádek „už odesláno“ pro starý termín zůstává. *Oprava:* smazat příslušné řádky při změně `datetime`.
- **`check_in_attendee` neověřuje status** ([`:2292`](supabase/sql/all-phases.sql#L2292)) – i omluvený účastník (`excused`) může být označen jako odbavený na místě. *Oprava:* přidat kontrolu `a.status = 'confirmed'`.
- **`event_signup_items`/`event_stops` chybí v realtime publikaci** ([`:3130`](supabase/sql/all-phases.sql#L3130)) – klient na ně navazuje `postgres_changes` subscription, která je ale trvale tichá; přidání položky do bring/ride listu nebo nové zastávky se ostatním nepropíše bez ručního refreshe. *Oprava:* `alter publication supabase_realtime add table ...`.
- **Storage bucket `event-photos` bez path-omezení** ([`:3050`](supabase/sql/all-phases.sql#L3050)) – insert/select politiky kontrolují jen `bucket_id`, ne cestu/vazbu na existující akci; bucket navíc `public: true`. *Oprava:* omezit politiky na cestu odpovídající existujícímu `event_id`.
- **`toggle_chat_reaction` neověřuje členství** ([`:2502`](supabase/sql/all-phases.sql#L2502)) – na rozdíl od `can_post_event_chat` nekontroluje, že `p_sender_name` odpovídá reálnému účastníkovi; umožňuje spoofing reakce pod cizím jménem. *Oprava:* přidat stejnou kontrolu členství.

### Edge Functions

- **`cleanup-expired-events` stejně bez autentizace** ([`:91`](supabase/functions/cleanup-expired-events/index.ts#L91)) – nižší dopad než u remindérů, protože `get_expired_event_ids` je časově podmíněná (nelze vynutit smazání aktivní akce).
- **Sekvence najdi→pošli→označ není atomická** ([`send-event-reminders/index.ts:95`](supabase/functions/send-event-reminders/index.ts#L95)) – souběžné spuštění může poslat stejnou připomínku dvakrát. *Oprava:* claim přes `insert ... on conflict do nothing` PŘED odesíláním, poslat jen když insert skutečně vložil řádek.
- **Chybí try/catch v hlavním cyklu** ([`:130`](supabase/functions/send-event-reminders/index.ts#L130)) – nezachycená výjimka u jedné připomínky zastaví zpracování všech zbylých v daném běhu.
- **Sériové odesílání bez limitu souběžnosti/timeoutu** ([`:69`](supabase/functions/send-event-reminders/index.ts#L69)) – u akce s desítkami odběratelů nebo pomalu odpovídajícím push serverem roste doba běhu lineárně, riziko timeoutu Edge Function.

### Frontend stránky

- **`EventPage` – zbytečný 1s interval bez memoizace** ([`:147`](client/src/pages/EventPage.jsx#L147)) – re-renderuje celý strom (chat, fotogalerie, signup boardy) každou sekundu bez ohledu na aktivní cooldown; žádná dětská komponenta není v `React.memo`.
- **`ManageEventPage` – neplatný token detekován jen při prvním loadu** ([`:197`](client/src/pages/ManageEventPage.jsx#L197)) – periodický refresh ani akce (moderace, editace, mazání) tuto kontrolu nemají; uživatel uvízne na needitovatelné stránce s opakujícím se genereckým toastem.
- **`ManageEventPage` – organizátorský token trvale viditelný jako plain text** ([`:681`](client/src/pages/ManageEventPage.jsx#L681)) – bez maskování nebo copy-to-clipboard tlačítka; screenshot stránky token prozradí.
- **`CreatePollPage` nekontroluje termín v budoucnosti** ([`:46`](client/src/pages/CreatePollPage.jsx#L46)) – na rozdíl od `CreateEventPage`; anketa s prošlým termínem projde a po finalizaci vytvoří akci s datem v minulosti.
- **Neúplně vyplněná afterparty se tiše zahodí** ([`CreateEventPage.jsx:68`](client/src/pages/CreateEventPage.jsx#L68)) – bez toastu/chyby, uživatel si myslí, že se uložila.
- **`PollPage` stav se neresetuje mezi anketami** ([`:26`](client/src/pages/PollPage.jsx#L26)) – jméno hlasujícího, výběr, finalizační PIN zůstávají ze staré ankety při přechodu v rámci HashRouteru.

### Komponenty

- **„Nabídnout výměnu“ ve skutečnosti okamžitě maže spolujezdce** ([`SignupBoard.jsx:260`](client/src/components/SignupBoard.jsx#L260)) – bez potvrzení, popisek neodpovídá destruktivní akci.
- **Hromadné stažení fotek selže jako celek** ([`PhotoGallery.jsx:117`](client/src/components/PhotoGallery.jsx#L117)) – `Promise.all` fail-fast; jedna chyba zahodí i úspěšně stažené fotky. *Oprava:* `Promise.allSettled`.
- **Smazání zastávky itineráře bez potvrzení** ([`EventStops.jsx:67`](client/src/components/EventStops.jsx#L67)) – nekonzistentní s zbytkem appky (mazání akce/účastníka má `window.confirm`).
- **`ModalOverlay` nezamyká scroll pozadí** ([`:92`](client/src/components/ModalOverlay.jsx#L92)) – žádné `overflow: hidden` na body při otevření.
- **Výběr času nekontroluje, že už dnes uplynul** ([`EventDateTimePicker.jsx:139`](client/src/components/EventDateTimePicker.jsx#L139)) – kontrola „nelze vybrat minulost“ funguje jen na úrovni dne.

### Accessibility

- **Formulářová pole bez `htmlFor`/`id` svázání** ([`ManageEventPage.jsx:799`](client/src/pages/ManageEventPage.jsx#L799)) – PIN, název akce, místo, zpráva u šťouchnutí; čtečka spadne na placeholder místo labelu.
- **Chat bez `aria-live`** ([`EventChat.jsx:286`](client/src/components/EventChat.jsx#L286)) – nové zprávy z realtime subscription nejsou uživatelům čteček vůbec ohlášené.
- **`role="radiogroup"` bez roving tabindex/šipek** ([`EventPage.jsx:764`](client/src/pages/EventPage.jsx#L764)) – u výběru stavu účasti; porušuje ARIA APG vzor radiogroup.

### CI

- **`lint` skript se nikde nevolá** ([`deploy-pages.yml:30`](.github/workflows/deploy-pages.yml#L30)).
- **`test:a11y`/`audit:a11y` běží jen lokálně** ([`client/package.json:11`](client/package.json#L11)) – nikdy v CI.

### Build

- **Chybí SIGINT/SIGTERM handler** ([`run-vite-safe.mjs:44`](client/scripts/run-vite-safe.mjs#L44)) – Ctrl+C při `npm run dev` může nechat ve `/tmp` osiřelou kopii projektu včetně `.env.local`; experimentálně reprodukováno.

---

## Nízká závažnost / drobnosti

Tyto nálezy nebyly individuálně ověřovány druhým agentem (jde o menší dopad), ale jsou podložené konkrétním kódem.

**Validace vstupů**
- Chybí horní limit délky u jmen/názvů/popisů ve `CreateEventPage.jsx:295`, `CreatePollPage.jsx:87`
- `CreateEventPage.jsx:320` – `required` bez `.trim()` propustí hodnotu složenou jen z mezer
- `add_signup_item` (`all-phases.sql:2600`) nekontroluje horní limit kapacity (CHECK constraint pak vyhodí syrovou DB chybu)
- `create_event_poll` (`:3877`) nevaliduje, že každá položka obsahuje location i datetime
- `vote_event_poll` (`:3945`) jde zavolat i po finalizaci ankety

**Race conditions / konzistence**
- `add_event_stop` (`:2722`) počítá pozici bez zámku (read-then-write)
- `finalize_event_poll` (`:3994`) volá úklid expirovaných anket na svém začátku, může smazat právě finalizovanou anketu
- Timing-unsafe porovnání `organizer_token`/`creator_token` (`<>`/`=` místo constant-time), napříč RPC funkcemi (`:3785`)
- `unregister_push_subscription` (`:2165`) ruší subscription jen podle endpointu bez vazby na event_id
- `register_push_subscription` (`:2132`) přepisuje event_id existující subscription podle endpointu

**Duplicitní kód k refaktoringu**
- PIN input duplikovaný mezi `CreateEventPage.jsx:305` a `PollPage.jsx`
- Konfety implementované dvakrát nezávisle – `ConfettiBurst.jsx` vs `RsvpCelebration.jsx`
- Výpočet base path duplikovaný v `format.js:1` a `push.js`
- Mobile-detekce duplikovaná v `AddToHomeButton.jsx:38` a `AddToCalendarButton.jsx`
- Tři skoro identické fetch-bloky v `ManageEventPage.jsx:79` (loadEvent, hydrate efekt, periodický refresh)
- `loadEvent`/`hydrateEvent` duplikace v `EventPage.jsx:269`
- „Party“ tlačítko stylované copy-paste mezi `CreateEventPage.jsx:360` a `CreatePollPage.jsx`
- Čtveřice tlačítek duplikovaná pro mobil/desktop v `ManageEventPage.jsx:571`

**Drobné correctness bugy**
- `.ics` generátor (`AddToCalendarButton.jsx:97`) obchází sdílený `parseLocalDateTime`
- Přípona souboru u uploadu se bere naivním `file.name.split('.').pop()` (`api.js:361`) – bez tečky vrátí celý název; navíc může vnést `/` do cesty
- `wrapCanvasText` (`qrPoster.js:46`) nezalamuje poslední řádek mimo hlavní smyčku
- `PageShell.jsx:21` natrvalo uloží odvozený systémový motiv do localStorage, appka pak přestane reagovat na jeho změnu
- `EventDateTimePicker.jsx:52` neřeší mezeru vzniklou přechodem na letní čas
- Barevný kontrast popisků dní v kalendáři pod WCAG AA (`EventDateTimePicker.jsx:221`, cca 2,6:1), stejný vzor i v `SignupBoard.jsx`/`EventChat.jsx`
- `organizerLinkStorage.js:115` – eviction je FIFO podle vložení, ne LRU podle použití
- `weather.js:135` nekontroluje `Number.isFinite` před `Math.round`
- `callRpc` (`api.js:6`) přeposílá syrovou DB chybovou zprávu bez rozlišení od záměrné aplikační výjimky
- Nekonzistentní `Number()` casting ID před RPC voláním (`api.js:67`)
- `uploadEventPhoto`/`recordEventPhoto` (`api.js:372`) – bez kompenzačního rollbacku při selhání druhého kroku vznikne osiřelý soubor ve storage
- ZIP stahování fotek (`PhotoGallery.jsx:115`) bez limitu na počet/velikost, vše v paměti najednou
- `send-event-reminders/index.ts:89` – trvale mrtvé push odběry (jiný chybový kód než 404/410) se nikdy neuklidí
- `cleanup-expired-events/index.ts:81` – try/catch jen kolem `listAllPhotoNames`, ne kolem `storage.remove()`/hlavního cyklu

**Accessibility drobnosti**
- Tlačítko „+“ pro reakci (`EventChat.jsx:330`) bez `aria-label`/`aria-expanded`, reakce bez `aria-pressed`

**CI/build drobnosti**
- `npm i --legacy-peer-deps` místo `npm ci` v `deploy-pages.yml:38`, přestože se cachuje lockfile
- Chybí `eslint-plugin-jsx-a11y` v `eslint.config.js:11`
- `collectCoverageFrom` nakonfigurováno, ale coverage se nikde nesbírá/nevynucuje (`jest.config.js:9`)
- `sw.js:40` – push handler parsuje `event.data.json()` bez try/catch
- Nepoužívaný `manifest.webmanifest`/`favicon.svg` v `client/public/`
- Nepoužívaná `server.proxy` sekce ve `vite.config.js:11`

---

## Vyvrácené nálezy

Dva nálezy po ověření neobstály:

1. **„`delete_event` nikdy nemaže fotky ze Storage“** – Ve skutečnosti `ManageEventPage.jsx` (`handleDelete`) volá `storage.remove()` client-side před smazáním akce – je to zdokumentovaný architektonický vzor (SQL/plpgsql nemůže volat Storage HTTP API). Nález nesprávně popsal architekturu. Nicméně ověřovací agent zároveň upozornil, že chybějící DELETE RLS politika (viz [kritický nález #2](#2-smazané-fotky-zůstávají-navždy-veřejně-dostupné)) znamená, že toto volání pravděpodobně reálně nefunguje – jde tedy o jiný, konkrétnější a už zachycený problém.
2. **„Jméno v RSVP formuláři není trimované, HTML5 `required` nezabrání odeslání samých mezer“** – Klientský popis je přesný, ale backendová RPC `submit_rsvp` sama dělá `nullif(trim(p_name), '')` a při prázdném výsledku vyhodí výjimku – insert do DB se vůbec neprovede. Dopad je čistě kosmetický (chybová hláška místo okamžité klientské validace), ne data-integrity problém.

---

## Doporučené pořadí oprav

1. RLS na `event_polls` + na zbytku tabulek s `USING(true)`/triviálně pravdivými politikami (kritické úniky dat a tokenů)
2. Storage DELETE politika pro `event-photos`
3. Auth guard na obě Edge Functions (`send-event-reminders`, `cleanup-expired-events`)
4. Oprava `jest.config.js` + zapojení testů/lintu/a11y auditu do CI (`pull_request` trigger)
5. `unclaim_signup_item` ownership check
6. Zbytek high-severity položek (identita organizátora, reset session identity, a11y modálů, HMR) podle kapacity týmu
7. Postupné dočištění medium/low položek, s prioritou na data-integrity a UX regrese (afterparty se tiše zahodí, mazání bez potvrzení)
