# ruin

RSVP app for friend groups powered by Supabase.

## Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Supabase Postgres + RPC

## Run locally

```bash
npm install
npm run dev
```

The root script runs the Vite client.

## Structure

- `client` - Vite frontend
- `supabase/sql` - SQL scripts for schema, RPC functions, and RLS

## Notes

- Organizer actions require the token that is included in the manage URL.

## GitHub Pages deploy

This repo is configured to deploy the frontend from `client` to GitHub Pages using `.github/workflows/deploy-pages.yml`.

Important: GitHub Pages hosts only static files, which is fine because data/API is handled by Supabase.

### 1. Set repository variables

On GitHub repository `RUin-`, set:

- Settings -> Secrets and variables -> Actions -> Variables -> New repository variable
- Name: `VITE_SUPABASE_URL`
- Value: your Supabase project URL, e.g. `https://your-project-ref.supabase.co`
- Name: `VITE_SUPABASE_ANON_KEY`
- Value: your Supabase anon/publishable key

### 2. Enable GitHub Pages

- Settings -> Pages
- Source: GitHub Actions

### 3. Push to `main`

Every push to `main` deploys frontend automatically.
