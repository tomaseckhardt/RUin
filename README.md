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