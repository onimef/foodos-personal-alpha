# FoodOS Personal Alpha v0.2

This package evolves the v0.1 local vertical slice into a cloud-backed, installable PWA architecture.

## Implemented
- Supabase email magic-link authentication
- real Household + Person boundary
- Postgres schema
- database-enforced Row Level Security
- event-sourced inventory
- PURCHASE / MANUAL_ADD / RECIPE_USE / CONSUMPTION / WASTE / CORRECTION / TRANSFER / REVERSAL ontology
- deterministic inventory projection
- VERIFIED / CALCULATED / ESTIMATED / UNKNOWN confidence states
- explicit correction events that preserve history
- reversal-based undo
- prepared food + prepared-food event ledger
- deterministic meal feasibility/ranking
- structured recommendation reason codes
- persisted CookSession
- atomic recipe-use commit when MADE IT is confirmed
- leftover creation
- Eat One event
- PWA manifest + service worker

## Important security rule
The browser uses only a Supabase publishable/anon key. Never put a service_role key in `config.js`.
Household isolation is enforced with Postgres Row Level Security.

## Connect the cloud backend
1. Create a Supabase project.
2. Open SQL Editor and run `supabase/migrations/001_initial.sql`.
3. In Authentication, enable Email / Magic Link.
4. Add the deployed app URL to allowed redirect URLs.
5. Copy `config.example.js` to `config.js`.
6. Set:
   - SUPABASE_URL
   - SUPABASE_PUBLISHABLE_KEY
7. Deploy the folder over HTTPS.
8. Open the deployed URL in Safari on iPhone.
9. Share → Add to Home Screen.

## Why deployment is not included in this zip
A real hosted alpha requires credentials/account authorization for the chosen cloud host and Supabase project.
The package is deployment-ready, but credentials are intentionally not embedded.

## Dogfood acceptance test
- Sign in on iPhone.
- Create household.
- Add real food.
- Close and reopen app.
- Verify state persists.
- Get a recommendation grounded in inventory.
- Start cooking.
- Confirm Made It.
- Verify ingredient inventory decreased.
- Save leftovers.
- Eat one later.
- Verify remaining servings and event history.
- Correct an inventory quantity.
- Undo the correction and verify state returns correctly.

## Local architecture check
If Node is installed, run:
`node tests/architecture.test.js`

This does not replace a Supabase migration test, but it verifies the required v0.2 architecture elements are present.


## v0.2.1 deployment additions
- GitHub Pages deployment workflow
- build-time injection of public Supabase URL/publishable key
- `.gitignore` protection against committing local config
- dogfood issue-log CSV
- browser smoke-check page

The only external prerequisites now are:
1. a Supabase project with the included migration applied; and
2. a GitHub repository/Pages deployment target.
