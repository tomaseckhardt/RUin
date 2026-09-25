# Jak přispívat do projektu RUin

**Čeština** · [English](CONTRIBUTING.en.md)

Díky, že chceš přispět. Tenhle dokument popisuje doporučený postup, aby review proběhlo rychle a bez zbytečných vratek.

## Typy příspěvků

- opravy bugů
- zlepšení UX/UI
- zlepšení přístupnosti
- překlady a lokalizace
- testy a dokumentace
- refaktoring beze změny funkčního chování

## Než začneš

1. Zkontroluj existující issues a pull requesty, jestli už někdo stejnou věc neřeší.
2. U větších změn otevři nejdřív issue s návrhem řešení.
3. Domluv se na scope změny, aby se minimalizovaly konflikty.

## Lokální vývoj

Požadavky:

- Node.js 22+
- npm 10+
- `client/.env.local` se Supabase URL a klíčem (viz [README](README.md#konfigurace-prostředí))

Instalace a start:

```bash
npm install
npm run dev
```

Testy a kontrola:

```bash
npm --prefix client run lint
npm test
npm run audit:a11y
npm run build
```

Lint a testy spouští i CI u každého pull requestu do `main` - PR s chybou v lintu nebo v testech neprojde.

## Kodérské zvyklosti

- Drž změny malé a tematicky jednotné.
- Pojmenování proměnných a funkcí udržuj čitelné a konzistentní.
- Neformátuj nesouvisející části souborů.
- Když měníš UI, ověř desktop i mobil, světlý i tmavý režim a češtinu i angličtinu.
- Když měníš přístupnost, doplň nebo uprav testy.
- Texty v UI nepiš natvrdo do komponent - přidej klíč do `client/src/locales/cs.js` i `en.js` a použij `t()` (viz [Lokalizace v README](README.md#lokalizace-čeština-a-angličtina)).
- Změny databáze patří přímo do `supabase/sql/all-phases.sql`, psané idempotentně. Každou novou `raise exception` hlášku doplň do `client/src/locales/serverMessages.en.js`, jinak spadne test.

## Konvence commitů

Doporučené prefixy:

- `feat:` nová funkcionalita
- `fix:` oprava bugu
- `docs:` dokumentace
- `test:` testy
- `refactor:` změna struktury beze změny chování
- `chore:` technická údržba

Příklad:

```text
fix: oprav validaci duplicitního telefonu v RSVP flow
```

## Branch workflow (důležité)

Pro cizí contributory platí:

- nikdy nepushuj změny přímo do `main`
- vždy si vytvoř vlastní branch a pošli změnu přes Pull Request

Doporučený postup:

```bash
git checkout -b feat/kratky-popis-zmeny
# proveď změny
git add .
git commit -m "feat: krátký popis"
git push -u origin feat/kratky-popis-zmeny
```

Pak otevři Pull Request z tvé branche do `main`.

## Pull request checklist

Před odesláním PR ověř:

- [ ] změna je pokrytá testy (nebo je jasně vysvětlené, proč ne)
- [ ] lokálně prošel lint i build
- [ ] lokálně prošly testy relevantní pro změnu
- [ ] nové texty v UI jsou v češtině i angličtině
- [ ] aktualizovaná dokumentace (README nebo jiná, v obou jazycích)
- [ ] PR popisuje co, proč a jak bylo ověřeno

## Jak má vypadat popis PR

- Stručné shrnutí změny.
- Motivace a kontext.
- Krokový postup testování.
- Screenshoty/videa u změn UI (pokud to dává smysl).

## Bezpečnost

Nalezené zranitelnosti nehlas veřejně v issue. Použij postup v [SECURITY.md](SECURITY.md).

Před změnou RLS politik, RPC funkcí nebo přidáním nové tabulky si přečti
[SECURITY_MODEL.md](SECURITY_MODEL.md) - popisuje, jak appka řeší (a neřeší)
identitu a autorizaci (žádná autentizace, tokeny v odkazech jako jediná
oprávnění, proč musí RLS defaultně vše zamítat a autorizaci ověřuje až RPC
funkce). Bez tohohle kontextu je snadné nevědomky zopakovat chybu, která už
v projektu jednou byla a je zdokumentovaná v [CODE_REVIEW.md](CODE_REVIEW.md).
