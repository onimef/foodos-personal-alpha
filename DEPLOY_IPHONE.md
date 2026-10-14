# Fastest iPhone Alpha Deployment

## Backend
Use Supabase for Auth + Postgres + RLS.

## Frontend
Any static HTTPS host works (Vercel, Netlify, Cloudflare Pages, GitHub Pages with appropriate config, etc.).

## Required secrets/config
The frontend only needs:
- Supabase project URL
- Supabase publishable/anon key

These are browser-safe when RLS is correctly configured. Never expose a service-role key.

## iPhone install
Once hosted over HTTPS:
1. Open the FoodOS URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch FoodOS from the new icon.

The service worker and web-app manifest are already included.
