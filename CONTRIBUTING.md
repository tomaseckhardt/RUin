# Jak prispivat do projektu RUin

Diky, ze chces prispet. Tenhle dokument popisuje doporuceny postup, aby review probehlo rychle a bez zbytecnych vratek.

## Typy prispevku

- opravy bugu
- zlepseni UX/UI
- zlepseni pristupnosti
- testy a dokumentace
- refaktoring bez zmeny funkcniho chovani

## Nez zacnes

1. Zkontroluj existujici issue a pull requesty, jestli uz nekdo stejnou vec neresi.
2. U vetsich zmen otevri nejdriv issue s navrhem reseni.
3. Domluv se na scope zmeny, aby se minimalizovaly konflikty.

## Lokální vyvoj

Pozadavky:

- Node.js 22+
- npm 10+

Instalace a start:

```bash
npm install
npm run dev
```

Testy a kontrola:

```bash
npm test
npm run audit:a11y
npm run build
```

## Koderske zvyklosti

- Drz zmeny male a tematicky jednotne.
- Pojmenovani promennych a funkci udrzuj citelne a konzistentni.
- Neformatuj nesouvisejici casti souboru.
- Kdyz menis UI, over desktop i mobile.
- Kdyz menis pristupnost, dopln nebo uprav testy.

## Konvence commitu

Doporucene prefixy:

- `feat:` nova funkcionalita
- `fix:` oprava bugu
- `docs:` dokumentace
- `test:` testy
- `refactor:` zmena struktury bez zmeny chovani
- `chore:` technicka udrzba

Priklad:

```text
fix: oprav validaci duplicitniho telefonu v RSVP flow
```

## Branch workflow (dulezite)

Pro cizi contributory plati:

- nikdy nepushuj zmeny primo do `main`
- vzdy si vytvor vlastni branch a posli zmenu pres Pull Request

Doporuceny postup:

```bash
git checkout -b feat/kratky-popis-zmeny
# proved zmeny
git add .
git commit -m "feat: kratky popis"
git push -u origin feat/kratky-popis-zmeny
```

Pak otevri Pull Request z tve branche do `main`.

## Pull request checklist

Pred odeslanim PR over:

- [ ] zmena je pokryta testy (nebo je jasne vysvetleno proc ne)
- [ ] lokalne prosel build
- [ ] lokalne prosly testy relevantni pro zmenu
- [ ] aktualizovana dokumentace (README nebo jina)
- [ ] PR popisuje co, proc a jak bylo overeno

## Jak ma vypadat PR popis

- Strucne shrnuti zmeny.
- Motivace a kontext.
- Krokovy postup testovani.
- Screenshoty/videa u zmen UI (pokud dava smysl).

## Bezpecnost

Nalezene zranitelnosti nehlas verejne v issue. Pouzij postup v [SECURITY.md](SECURITY.md).

Pred zmenou RLS politik, RPC funkci nebo pridanim nove tabulky si prectete
[SECURITY_MODEL.md](SECURITY_MODEL.md) - popisuje, jak appka resi (a neresi)
identitu a autorizaci (zadna autentizace, `organizer_token` jako jediny bearer
credential, proc musi RLS defaultne vse zamitat a autorizaci overuje az RPC
funkce). Bez tohohle kontextu je snadne nevedomky zopakovat chybu, ktera uz
v projektu jednou byla a je zdokumentovana v [CODE_REVIEW.md](CODE_REVIEW.md).
