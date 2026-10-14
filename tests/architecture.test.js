
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/001_initial.sql'),'utf8');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
const must=[
  "('PURCHASE','MANUAL_ADD','RECIPE_USE','CONSUMPTION','WASTE','CORRECTION','TRANSFER','REVERSAL')",
  'create or replace view public.inventory_projection',
  'create or replace function public.correct_inventory_quantity',
  'create or replace function public.reverse_inventory_event',
  'create or replace function public.complete_cook_session',
  'create or replace view public.prepared_food_projection',
  'alter table public.inventory_events enable row level security'
];
for(const s of must){if(!sql.includes(s))throw new Error('Missing SQL architecture element: '+s)}
if(!app.includes("signInWithOtp")) throw new Error("Auth flow missing");
if(!app.includes("reasonCodes")) throw new Error("Structured WHY reason codes missing");
if(!app.includes("complete_cook_session")) throw new Error("Atomic cook completion RPC missing from client");
console.log("FoodOS v0.2 architecture checks passed.");
