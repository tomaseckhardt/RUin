# RUin Client

[Čeština](README.md) · **English**

The RUin frontend app (React 19 + Vite 8 + Tailwind CSS 4). The full project documentation is in the [root README](../README.en.md).

## Getting started

First create `client/.env.local` with the Supabase URL and key (see [Environment configuration](../README.en.md#environment-configuration)).

From the repository root:

```bash
npm install
npm run dev
```

Or directly in the `client` directory:

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5173/. `dev`, `build` and `preview` go through `scripts/run-vite-safe.mjs`, which runs Vite from a temporary copy of the project (because of special characters in the path) - see [NPM scripts](../README.en.md#npm-scripts).

## Scripts

- `npm run dev` - development server
- `npm run build` - production build into `dist/`
- `npm run preview` - preview of the production build
- `npm run lint` - ESLint
- `npm test` - Jest (unit, component and a11y tests)
- `npm run test:a11y` - a11y tests only

## Structure

- `src/pages/` - screens, one per route (see [App pages](../README.en.md#app-pages))
- `src/components/` - UI components
- `src/lib/` - the API layer (`api.js`), the Supabase client, translations (`i18n.js`) and helpers
- `src/locales/` - Czech and English UI texts
- `src/test/` - Jest setup and test helpers
- `public/` - service worker, icons and the manifest

## Important for contributors

- don't push directly to `main`
- always work in your own branch
- send changes via a Pull Request to `main`
- add new UI texts to both `src/locales/cs.js` and `en.js`

Example:

```bash
git checkout -b feat/short-description
git push -u origin feat/short-description
```

The detailed rules are in [CONTRIBUTING.en.md](../CONTRIBUTING.en.md).
