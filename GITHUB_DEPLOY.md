# FoodOS GitHub Pages Deployment

This repo is prepared for GitHub Pages.

## Repository variables required
In the GitHub repository, configure these **Actions variables**:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Do not use a Supabase service-role key.

The included workflow writes those two public values into `config.js` during deployment and publishes the static PWA to GitHub Pages.

## Required Supabase redirect URL
After GitHub Pages has deployed, add the Pages URL to the Supabase Authentication allowed redirect URLs.

## Deployment
Push to `main` or manually run the `Deploy FoodOS Alpha to GitHub Pages` workflow.

## iPhone
Open the resulting HTTPS Pages URL in Safari:
Share → Add to Home Screen.
