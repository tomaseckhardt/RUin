# ruin

Full-stack RSVP app for friend groups.

## Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express
- Database: SQLite via `better-sqlite3`

## Run locally

```bash
npm install
npm run dev
```

The root script runs both client and server with `concurrently`.

## Structure

- `client` - Vite frontend
- `server` - Express API and SQLite database

## Notes

- Organizer actions require the token that is included in the manage URL.

## GitHub Pages deploy

This repo is configured to deploy the frontend from `client` to GitHub Pages using `.github/workflows/deploy-pages.yml`.

Important: GitHub Pages hosts only static files. The backend must run separately (for example Render or Railway).

### 1. Deploy backend first

Deploy `server` and copy your public API URL, for example:

`https://ruin-api.onrender.com`

### 2. Set repo variable for frontend API

On GitHub repository `RUin-`, set:

- Settings -> Secrets and variables -> Actions -> Variables -> New repository variable
- Name: `VITE_API_BASE_URL`
- Value: your backend URL (without trailing slash), e.g. `https://ruin-api.onrender.com`

### 3. Enable GitHub Pages

- Settings -> Pages
- Source: GitHub Actions

### 4. Push to `main`

Every push to `main` deploys frontend automatically.

### 5. Backend CORS

Set backend environment variable:

- `CORS_ORIGIN=https://tomaseckhardt.github.io`

If needed, you can temporarily use `*`, but explicit origin is better for production.
