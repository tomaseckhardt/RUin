# RUin Client

**Čeština** · [English](README.en.md)

Frontend aplikace RUin (React 19 + Vite 8 + Tailwind CSS 4). Celková dokumentace projektu je v [kořenovém README](../README.md).

## Spuštění

Nejdřív vytvoř `client/.env.local` se Supabase URL a klíčem (viz [Konfigurace prostředí](../README.md#konfigurace-prostředí)).

Z kořene repozitáře:

```bash
npm install
npm run dev
```

Nebo přímo v adresáři `client`:

```bash
npm install
npm run dev
```

Dev server běží na http://localhost:5173/. `dev`, `build` i `preview` jdou přes `scripts/run-vite-safe.mjs`, který spouští Vite z dočasné kopie projektu (kvůli zvláštním znakům v cestě) - viz [NPM skripty](../README.md#npm-skripty).

## Skripty

- `npm run dev` - vývojový server
- `npm run build` - produkční build do `dist/`
- `npm run preview` - náhled produkčního buildu
- `npm run lint` - ESLint
- `npm test` - Jest (jednotkové, komponentové a a11y testy)
- `npm run test:a11y` - jen a11y testy

## Struktura

- `src/pages/` - obrazovky, jedna na routu (viz [Stránky aplikace](../README.md#stránky-aplikace))
- `src/components/` - UI komponenty
- `src/lib/` - API vrstva (`api.js`), Supabase klient, překlady (`i18n.js`) a helpery
- `src/locales/` - české a anglické texty UI
- `src/test/` - Jest setup a testovací helpery
- `public/` - service worker, ikony a manifest

## Důležité pro contributory

- nepushovat přímo do `main`
- vždy pracovat ve vlastní branch
- změny posílat přes Pull Request do `main`
- nové texty v UI přidávat do `src/locales/cs.js` i `en.js`

Příklad:

```bash
git checkout -b feat/kratky-popis-zmeny
git push -u origin feat/kratky-popis-zmeny
```

Podrobnější pravidla jsou v [CONTRIBUTING.md](../CONTRIBUTING.md).
