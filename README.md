# Aromatique AI

React + TanStack Start frontend for the Aromatique AI fragrance recommendation research app.

## Local Development

```bash
npm install
npm run dev
```

Create `.env` from `.env.example` and fill the Supabase public values.

## Vercel Deployment

The project includes `vercel.json` and `vite.config.vercel.ts`.

Required environment variables:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Do not commit `.env` or private service keys.

## Supabase

The app calls the deployed `aromatique-chat` Supabase Edge Function for chat, experiment assignment, familiarity capture, and recommendations.
