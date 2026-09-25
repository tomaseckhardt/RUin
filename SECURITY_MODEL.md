# Bezpečnostní model RUin

**Čeština** · [English](SECURITY_MODEL.en.md)

Tenhle dokument popisuje, jak appka řeší (a neřeší) identitu a autorizaci. Dřív
to byla jen tribal knowledge v hlavách lidí kolem projektu a seznam už odhalených
chyb v [CODE_REVIEW.md](CODE_REVIEW.md) - tohle je pokus napsat to jednou pořádně,
ať se stejné chyby neopakují v novém kódu.

Nejde o totéž co [SECURITY.md](SECURITY.md) - to popisuje, kam soukromě nahlásit
nalezenou zranitelnost. Tenhle dokument popisuje architekturu a mentální model,
který musí mít v hlavě každý, kdo přidává novou tabulku, RPC funkci nebo endpoint.

## V kostce

- V appce neexistuje žádná autentizace. Supabase Auth se nepoužívá vůbec.
- Jediná "identita" hostů je jméno, které si každý sám napíše do formuláře. Dvě
  různé osoby si můžou obě napsat "Petr" a appka je nedokáže rozlišit.
- Výjimkou jsou náhodné tokeny, které fungují jako bearer credential:
  `organizer_token` (správa akce), `event_polls.creator_token` (vyhodnocení
  ankety) a `owners.token` (skupiny kontaktů a šablony akcí). Kdo token má, má
  danou roli, tečka.
- Protože klient nemá nic silnějšího než "napsal jsem svoje jméno" nebo "mám
  tenhle token", **RLS na všech tabulkách musí defaultně vše zamítat** a
  **veškerá autorizace se ověřuje uvnitř SECURITY DEFINER RPC funkcí**, ne přes
  klientský filtr.

## 1. Žádná autentizace - identita je jen samodeklarované jméno

RUin nepoužívá Supabase Auth, žádné uživatelské účty, hesla ani session tokeny
vázané na uživatele. Jméno účastníka v RSVP formuláři, jméno odesílatele v chatu,
jméno "kdo si bere co" v seznamu na sraz, jméno u šťouchnutí (ping) - to všechno
je prostý text, který si autor sám napsal do inputu a appka ho bez ověření uloží.

Důsledek: pokud dva lidé na stejné akci napíšou stejné jméno (schválně, nebo
omylem), appka je z pohledu dat nerozezná. Kdokoli, kdo zná (nebo uhodne) jméno
jiného účastníka viditelné veřejně na stránce akce, může teoreticky zavolat
stejné RPC pod tímto jménem - to není bug, který jde "opravit" v jedné funkci,
je to důsledek toho, že appka nemá auth vrstvu vůbec. Konkrétní příklad, kde se
na tenhle rozdíl (mezi "ověřit, že pole nedělá dvojí roli" a "skutečně ověřit
identitu") narazilo, je popsaný přímo v kódu u `unclaim_signup_item` (fáze
"Realtime read hardening", `supabase/sql/all-phases.sql`) - stojí tam za
přečtení jako přesná formulace limitu tohoto modelu.

Co z toho plyne pro nový kód: nikdy nepočítej s tím, že `p_attendee_name`,
`p_sender_name` apod. je důkaz, kdo volání skutečně provedl. Je to jen popisek,
který si vymyslel volající.

## 2. Výjimka: tokeny jako bearer credential

### Organizátor: `organizer_token` a správcovský PIN

Organizátor akce nemá účet ani heslo - má jen **odkaz na správu akce**
(`.../#/event/:eventId/manage?token=...`). Ten `token` je náhodný řetězec
(`_random_token()` přes `pgcrypto`/`gen_random_bytes()`, viz "Security
hardening" fáze), uložený v `events.organizer_token` a poslaný v query stringu
odkazu v čistém textu.

Klíčová vlastnost: **kdo má tuhle URL, je organizátor** - žádná session, žádné
cookie, žádná vazba na zařízení. Token se posílá jako parametr do RPC funkcí
(`p_token`/`p_organizer_token`) a funkce ho porovná s hodnotou uloženou u dané
akce. Klient si token po prvním otevření správy uloží do `localStorage`
(`ruin-organizer-tokens`, posledních 30 akcí) a z adresního řádku ho odstraní -
kdo má přístup k tomu prohlížeči, je tedy organizátor taky.

Kdo odkaz nemá, může správu odemknout 4místným správcovským PINem, který
organizátor zvolí při založení akce (`get_organizer_path_with_pin`). PIN je
uložený jako bcrypt hash (`events.organizer_pin_hash`) a protože 4 číslice jsou
jen 10 000 kombinací, po chybných pokusech se zamyká: po 5 na 15 minut, po 10 na
hodinu, po 15 na 24 hodin.

Token je záměrně uložený jako čitelný plaintext, ne jako jednosměrný hash.
Tohle je vědomý kompromis, ne opomenutí - flow "zapomněl jsi odkaz na správu?
zadej PIN" po ověření PINu vrací **původní token zpátky uživateli**, aby si mohl
znovu otevřít správu akce. To s jednosměrným hashem nejde - hash se nedá zpětně
převést na originál. Přesně tenhle tradeoff (a proč by jeho oprava znamenala
předělat celý recovery flow, ne jen jednu funkci) je zdokumentovaný v komentáři
u fáze 14 (`-- Phase 14: Security/correctness hardening...`) v
`supabase/sql/all-phases.sql`.

### Tvůrce ankety: `event_polls.creator_token`

Stejný princip (server-side ověření tokenu proti uloženému, žádná session)
platí i pro `event_polls.creator_token` u ještě nezaložených akcí (anket na
termín/místo) - odkaz tvůrce má tvar `.../#/poll/:pollId?token=...`.

### Skupiny a šablony: `owners.token`, telefon a 6místný kód

Skupiny kontaktů a šablony akcí patří "vlastníkovi" (tabulka `owners`), který se
identifikuje telefonním číslem a 6místným kódem přes
`access_owner_account(name, phone, code)`. Je to jedna funkce pro přihlášení i
registraci: když účet s daným (normalizovaným) telefonem existuje, ověří kód,
jinak účet založí. Kód je uložený jako bcrypt hash (`owners.code_hash`) se
stejným zamykáním po chybných pokusech jako PIN. Funkce vrátí `ownerId` a
`token`, klient je uloží do `localStorage` (`ruin-owner-identity`) a každá RPC
nad skupinami a šablonami je ověřuje (`v_owner.token <> p_token`). Token se při
dalším přihlášení nemění.

## 3. Proto: RLS musí defaultně vše zamítat, RPC ověřuje autorizaci sama

Protože klient nemá nic silnějšího, čím by prokázal identitu nebo vlastnictví,
než token nebo jméno, které sám pošle, **nesmí se tomuhle tvrzení věřit na
úrovni Row Level Security politiky**. Kdyby RLS spoléhala na to, že klient
pošle správný `event_id` filtr nebo že se "nikdo stejně nebude ptát na cizí
data", stačí přímý REST dotaz s veřejným anon klíčem (ten je veřejně vidět ve
frontend bundlu) mimo appku, bez filtru, a je po autorizaci.

Zavedený vzor v `supabase/sql/all-phases.sql` je:

- SELECT/INSERT/UPDATE/DELETE politiky pro `anon`/`authenticated` na
  citlivých tabulkách jsou `using (false)` (případně `with check (false)`) -
  žádný přímý přístup z klienta není povolený vůbec. Najdeš je snadno:

  ```bash
  grep -n "using (false)" supabase/sql/all-phases.sql
  ```

- Veškeré čtení i zápis jde přes `SECURITY DEFINER` RPC funkce
  (`language plpgsql security definer set search_path = public`), které
  autorizaci ověřují **samy, uvnitř těla funkce** - typicky porovnáním
  caller-supplied tokenu s hodnotou uloženou v databázi, ne přijetím
  klientského tvrzení jako faktu. Příklad z `moderate_attendee`:

  ```sql
  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;
  ```

  Stejný vzor (dohledej si řádek `v_event.organizer_token <> p_token`,
  `v_poll.creator_token <> p_token` nebo `v_owner.token <> p_token` a exception
  s českou hláškou) používají `delete_event`, `update_event`,
  `finalize_event_poll`, RPC nad skupinami a šablonami a další - kdykoli funkce
  mění nebo odhaluje něco vázaného na akci, anketu nebo vlastníka, první věc,
  kterou udělá, je tenhle porovnávací check.

Proč na tomhle tolik záleží, má appka i vlastní historku, ne jen teorii: fáze
"Realtime read hardening" (`-- ==================== Realtime read hardening
====================` v `supabase/sql/all-phases.sql`) popisuje přesně tenhle
druh chyby nalezený a opravený najednou na devíti tabulkách
(`event_polls`/`event_poll_options`/`event_poll_votes`, `event_photos`,
`event_chat_messages`/`event_chat_message_reactions`,
`event_signup_items`/`event_signup_claims`, `event_stops`) - politiky byly
`using (true)` nebo `using (event_exists(event_id))` (což je díky FK triviálně
pravdivé pro každý existující řádek), takže šlo přímým REST dotazem bez
`event_id` filtru přečíst chat, fotky, ankety i seznamy ze VŠECH akcí v appce
najednou, ne jen z té jedné, na kterou má volající odkaz. Komentář u téhle
fáze stojí za přečtení celý - vysvětluje i to, proč se u tabulek s realtime
subscriptions (chat, signup listy, zastávky) nešlo jen tak zamknout na
`using (false)`, ale musela se zavést vrstva RPC + přechod na
"poslouchej `event_realtime_ticks`, pak si dotáhni data znovu" vzor.

## 4. Pravidlo pro nový kód

Když přidáváš novou tabulku nebo RPC funkci:

1. **Nikdy nevěř klientem poslanému `event_id`, tokenu nebo jménu jako důkazu
   identity nebo vlastnictví samo o sobě.** Je to jen vstupní parametr, ne
   ověřený fakt.
2. Nová tabulka má na SELECT/INSERT/UPDATE/DELETE pro `anon`/`authenticated`
   defaultně `using (false)` (a `with check (false)` u zápisu), dokud
   neexistuje konkrétní důvod jinak.
3. Čtení i zápis jde přes `SECURITY DEFINER` RPC, která:
   - je `language plpgsql security definer set search_path = public`,
   - uvnitř těla ověří autorizaci - typicky `if v_event.organizer_token <>
     p_token then raise exception '...'` (nebo obdobné scoping podle
     `event_id`), přesně jako `moderate_attendee`/`delete_event`/
     `update_event`,
   - končí `grant execute on function public.fn_name(...) to anon,
     authenticated;`.
4. Pokud funkce mění existující signaturu (přidává/ubírá/přejmenovává
   parametr), potřebuje před sebou `drop function if exists
   public.fn_name(stare, typy);` - viz obecná konvence popsaná nahoře v
   `all-phases.sql` (a [CONTRIBUTING.md](CONTRIBUTING.md) k tomu, jak do
   schématu přispívat).
5. Chybové hlášky uvnitř RPC jsou vždy česky, srozumitelně pro koncového
   uživatele (`raise exception 'Neplatný organizátorský odkaz.'`), ne syrová
   Postgres chyba. Pro anglické UI je klient překládá podle přesného textu,
   takže každou novou hlášku doplň i do
   `client/src/locales/serverMessages.en.js` (hlídá to
   `client/src/lib/i18n.test.js`). Když se klient podle konkrétní hlášky
   rozhoduje, musí porovnávat `error.serverMessage` (původní text), ne
   přeložené `error.message`.

Pokud si nejsi jistý, jestli něco "stačí ověřit na klientovi" - nestačí.
Klientský kód v `client/src/lib/api.js` (jediné místo, které smí volat
`supabase.rpc(...)`) je jen tenká vrstva nad RPC; jediné místo, kde se
autorizace reálně vynucuje, je tělo SECURITY DEFINER funkce v
`supabase/sql/all-phases.sql`.

## Co tenhle model neřeší (a vědomě neřeší)

- Spoofing jména mezi účastníky stejné akce - appka nemá jak ověřit, že
  "Petr" volající RPC je ten samý "Petr", co si RSVPnul dřív. Toto je bez
  zásadní auth přestavby neopravitelné, jen zmírnitelné (viz bod 1 výše).
- Ztráta/sdílení manage odkazu = ztráta/sdílení role organizátora - kdo má
  URL s tokenem, je organizátor, i kdyby to byl náhodně přeposlaný odkaz.
  Totéž platí pro tokeny uložené v `localStorage` na sdíleném nebo cizím
  počítači.
- Účet pro skupiny a šablony je vázaný na telefonní číslo, které se nijak
  neověřuje (žádná SMS) - kdo číslo zaregistruje jako první, vlastní k němu
  účet. Jméno se při přihlášení jen přepíše.
- `/feedback` je záměrně veřejný - kdokoli přečte všechna hlášení včetně jmen
  (fáze 21 v `all-phases.sql`).
- Další konkrétní nálezy (chybějící ownership check u jedné RPC, chybějící
  server-side validace uploadu apod.) jsou vedené jako issues/nálezy v
  [CODE_REVIEW.md](CODE_REVIEW.md), ne duplikované tady - tenhle dokument
  popisuje model, ne aktuální seznam chyb.
