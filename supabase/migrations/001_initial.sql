
-- FoodOS Personal Alpha v0.2
-- Supabase/Postgres schema. Run in the Supabase SQL editor or via CLI migration.
-- InventoryEvent is authoritative; current inventory is a projection.

create extension if not exists pgcrypto;

do $$ begin
  create type public.inventory_event_type as enum
    ('PURCHASE','MANUAL_ADD','RECIPE_USE','CONSUMPTION','WASTE','CORRECTION','TRANSFER','REVERSAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.confidence_state as enum ('VERIFIED','CALCULATED','ESTIMATED','UNKNOWN');
exception when duplicate_object then null; end $$;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.persons (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null,
  is_child boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid references public.persons(id) on delete set null,
  role text not null default 'owner' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (household_id,user_id)
);

create table if not exists public.food_concepts (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  food_concept_id uuid references public.food_concepts(id),
  household_id uuid references public.households(id) on delete cascade,
  brand text,
  product_name text not null,
  barcode text,
  source text,
  verified_product_data boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  person_id uuid references public.persons(id) on delete set null,
  event_type public.inventory_event_type not null,
  food_concept_id uuid references public.food_concepts(id),
  product_id uuid references public.products(id),
  food_name text not null,
  quantity_delta numeric not null,
  unit text not null,
  storage_location text,
  confidence public.confidence_state not null default 'VERIFIED',
  metadata jsonb not null default '{}'::jsonb,
  reverses_event_id uuid references public.inventory_events(id),
  created_at timestamptz not null default now()
);

create index if not exists inventory_events_household_food_idx
  on public.inventory_events(household_id, lower(food_name), unit, created_at);
create unique index if not exists inventory_events_one_reversal_idx
  on public.inventory_events(reverses_event_id) where reverses_event_id is not null;

create table if not exists public.prepared_foods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  source_cook_session_id uuid,
  name text not null,
  servings_created numeric not null check(servings_created >= 0),
  storage_location text not null,
  prepared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  estimated_use_by timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.prepared_food_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  prepared_food_id uuid not null references public.prepared_foods(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  event_type text not null check(event_type in ('CREATED','CONSUMED','WASTE','CORRECTION','REVERSAL')),
  serving_delta numeric not null,
  reverses_event_id uuid references public.prepared_food_events(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  recipe_key text,
  title text not null,
  servings numeric,
  minutes integer,
  created_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  food_name text not null,
  quantity numeric not null,
  unit text not null
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  person_id uuid references public.persons(id),
  recipe_key text,
  title text not null,
  reason_codes text[] not null default '{}',
  status text not null default 'PRESENTED',
  created_at timestamptz not null default now()
);

create table if not exists public.cook_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  person_id uuid references public.persons(id),
  recipe_key text,
  title text not null,
  expected_use jsonb not null default '[]'::jsonb,
  actual_use jsonb,
  status text not null default 'STARTED' check(status in ('STARTED','COMPLETED','CANCELLED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.prepared_foods
  drop constraint if exists prepared_foods_source_cook_session_id_fkey;
alter table public.prepared_foods
  add constraint prepared_foods_source_cook_session_id_fkey
  foreign key(source_cook_session_id) references public.cook_sessions(id) on delete set null;

-- Membership helper deliberately SECURITY DEFINER so RLS can test membership without recursion.
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household_id and hm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

-- Enable RLS everywhere exposed.
alter table public.households enable row level security;
alter table public.persons enable row level security;
alter table public.household_members enable row level security;
alter table public.food_concepts enable row level security;
alter table public.products enable row level security;
alter table public.inventory_events enable row level security;
alter table public.prepared_foods enable row level security;
alter table public.prepared_food_events enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recommendations enable row level security;
alter table public.cook_sessions enable row level security;

-- Least-privilege grants: immutable event tables are not update/delete-able by client.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.food_concepts to authenticated;
grant select,insert on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select on public.persons to authenticated;
grant select,insert on public.products to authenticated;
grant select,insert on public.inventory_events to authenticated;
grant select,insert on public.prepared_foods to authenticated;
grant select,insert on public.prepared_food_events to authenticated;
grant select,insert on public.recipes to authenticated;
grant select,insert on public.recipe_ingredients to authenticated;
grant select,insert,update on public.recommendations to authenticated;
grant select,insert on public.cook_sessions to authenticated;

-- Drop/recreate policies for repeatability.
do $$ declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname='public'
  loop execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop;
end $$;

create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_insert on public.households for insert to authenticated
  with check ((select auth.uid()) = created_by);

create policy members_select on public.household_members for select to authenticated
  using (user_id=(select auth.uid()) or public.is_household_member(household_id));

create policy persons_select on public.persons for select to authenticated
  using (public.is_household_member(household_id));

create policy products_select on public.products for select to authenticated
  using (household_id is null or public.is_household_member(household_id));
create policy products_insert on public.products for insert to authenticated
  with check (household_id is not null and public.is_household_member(household_id));

create policy inventory_events_select on public.inventory_events for select to authenticated
  using (public.is_household_member(household_id));
create policy inventory_events_insert on public.inventory_events for insert to authenticated
  with check (public.is_household_member(household_id) and actor_user_id=(select auth.uid()));

create policy prepared_foods_select on public.prepared_foods for select to authenticated
  using (public.is_household_member(household_id));
create policy prepared_foods_insert on public.prepared_foods for insert to authenticated
  with check (public.is_household_member(household_id) and created_by=(select auth.uid()));

create policy prepared_events_select on public.prepared_food_events for select to authenticated
  using (public.is_household_member(household_id));
create policy prepared_events_insert on public.prepared_food_events for insert to authenticated
  with check (public.is_household_member(household_id) and actor_user_id=(select auth.uid()));

create policy recipes_select on public.recipes for select to authenticated
  using (household_id is null or public.is_household_member(household_id));
create policy recipes_insert on public.recipes for insert to authenticated
  with check (household_id is null or public.is_household_member(household_id));

create policy recipe_ingredients_select on public.recipe_ingredients for select to authenticated
  using (exists(select 1 from public.recipes r where r.id=recipe_id and (r.household_id is null or public.is_household_member(r.household_id))));
create policy recipe_ingredients_insert on public.recipe_ingredients for insert to authenticated
  with check (exists(select 1 from public.recipes r where r.id=recipe_id and public.is_household_member(r.household_id)));

create policy recommendations_select on public.recommendations for select to authenticated
  using (public.is_household_member(household_id));
create policy recommendations_insert on public.recommendations for insert to authenticated
  with check (public.is_household_member(household_id));
create policy recommendations_update on public.recommendations for update to authenticated
  using (public.is_household_member(household_id)) with check(public.is_household_member(household_id));

create policy cook_sessions_select on public.cook_sessions for select to authenticated
  using (public.is_household_member(household_id));
create policy cook_sessions_insert on public.cook_sessions for insert to authenticated
  with check (public.is_household_member(household_id));
-- Bootstrap household atomically.
create or replace function public.create_household(p_household_name text, p_person_name text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare h uuid; p uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.households(name,created_by) values(p_household_name,auth.uid()) returning id into h;
  insert into public.persons(household_id,display_name) values(h,p_person_name) returning id into p;
  insert into public.household_members(household_id,user_id,person_id,role) values(h,auth.uid(),p,'owner');
  return jsonb_build_object('household_id',h,'person_id',p);
end $$;
grant execute on function public.create_household(text,text) to authenticated;

-- Helper gets/creates a food concept without exposing writes directly.
create or replace function public.ensure_food_concept(p_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare fid uuid; n text := lower(trim(p_name));
begin
  select id into fid from public.food_concepts where normalized_name=n;
  if fid is null then
    insert into public.food_concepts(canonical_name,normalized_name) values(trim(p_name),n)
    returning id into fid;
  end if;
  return fid;
end $$;
grant execute on function public.ensure_food_concept(text) to authenticated;

create or replace function public.record_inventory_event(
  p_household_id uuid,p_event_type public.inventory_event_type,p_food_name text,
  p_quantity_delta numeric,p_unit text,p_storage_location text default null,
  p_confidence public.confidence_state default 'VERIFIED',p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare eid uuid; fid uuid;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Forbidden'; end if;
  fid:=public.ensure_food_concept(p_food_name);
  insert into public.inventory_events(household_id,actor_user_id,event_type,food_concept_id,food_name,quantity_delta,unit,storage_location,confidence,metadata)
  values(p_household_id,auth.uid(),p_event_type,fid,trim(p_food_name),p_quantity_delta,p_unit,p_storage_location,p_confidence,p_metadata)
  returning id into eid;
  return eid;
end $$;
grant execute on function public.record_inventory_event(uuid,public.inventory_event_type,text,numeric,text,text,public.confidence,jsonb) to authenticated;

-- Current inventory projection. CORRECTION is recorded as a delta by the correction RPC.
create or replace view public.inventory_projection
with (security_invoker=true) as
select
  household_id,
  lower(food_name) as food_key,
  min(food_name) as food_name,
  unit,
  sum(quantity_delta) as quantity,
  (array_agg(storage_location order by created_at desc) filter (where storage_location is not null))[1] as storage_location,
  (array_agg(confidence order by created_at desc))[1] as confidence,
  'Derived from household inventory events; latest explicit correction/measurement takes precedence through its delta.'::text as explanation
from public.inventory_events
group by household_id, lower(food_name), unit
having sum(quantity_delta) > 0.000001;

grant select on public.inventory_projection to authenticated;

create or replace function public.correct_inventory_quantity(
  p_household_id uuid,p_food_name text,p_unit text,p_actual_quantity numeric,p_storage_location text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare current_qty numeric:=0; delta numeric; eid uuid; fid uuid;
begin
  if not public.is_household_member(p_household_id) then raise exception 'Forbidden'; end if;
  select coalesce(sum(quantity_delta),0) into current_qty
  from public.inventory_events where household_id=p_household_id and lower(food_name)=lower(trim(p_food_name)) and unit=p_unit;
  delta:=p_actual_quantity-current_qty;
  fid:=public.ensure_food_concept(p_food_name);
  insert into public.inventory_events(household_id,actor_user_id,event_type,food_concept_id,food_name,quantity_delta,unit,storage_location,confidence,metadata)
  values(p_household_id,auth.uid(),'CORRECTION',fid,trim(p_food_name),delta,p_unit,p_storage_location,'VERIFIED',
    jsonb_build_object('previous_projected_quantity',current_qty,'corrected_actual_quantity',p_actual_quantity))
  returning id into eid;
  return eid;
end $$;
grant execute on function public.correct_inventory_quantity(uuid,text,text,numeric,text) to authenticated;

create or replace function public.reverse_inventory_event(p_event_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare src public.inventory_events%rowtype; rid uuid;
begin
  select * into src from public.inventory_events where id=p_event_id;
  if src.id is null or not public.is_household_member(src.household_id) then raise exception 'Forbidden or missing event'; end if;
  if exists(select 1 from public.inventory_events where reverses_event_id=p_event_id) then raise exception 'Event already reversed'; end if;
  insert into public.inventory_events(household_id,actor_user_id,person_id,event_type,food_concept_id,product_id,food_name,quantity_delta,unit,storage_location,confidence,metadata,reverses_event_id)
  values(src.household_id,auth.uid(),src.person_id,'REVERSAL',src.food_concept_id,src.product_id,src.food_name,-src.quantity_delta,src.unit,src.storage_location,'VERIFIED',
    jsonb_build_object('reversed_event_type',src.event_type),src.id)
  returning id into rid;
  return rid;
end $$;
grant execute on function public.reverse_inventory_event(uuid) to authenticated;

create or replace function public.complete_cook_session(p_session_id uuid,p_actual_use jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare s public.cook_sessions%rowtype; x jsonb; fid uuid;
begin
  select * into s from public.cook_sessions where id=p_session_id for update;
  if s.id is null or not public.is_household_member(s.household_id) then raise exception 'Forbidden or missing cook session'; end if;
  if s.status <> 'STARTED' then raise exception 'Cook session is not active'; end if;
  for x in select * from jsonb_array_elements(p_actual_use)
  loop
    fid:=public.ensure_food_concept(x->>'food');
    insert into public.inventory_events(household_id,actor_user_id,person_id,event_type,food_concept_id,food_name,quantity_delta,unit,confidence,metadata)
    values(s.household_id,auth.uid(),s.person_id,'RECIPE_USE',fid,x->>'food',-(x->>'qty')::numeric,x->>'unit','CALCULATED',
      jsonb_build_object('cook_session_id',s.id,'recipe_key',s.recipe_key));
  end loop;
  update public.cook_sessions set actual_use=p_actual_use,status='COMPLETED',completed_at=now() where id=s.id;
end $$;
grant execute on function public.complete_cook_session(uuid,jsonb) to authenticated;

create or replace function public.create_leftovers(p_session_id uuid,p_servings numeric,p_storage_location text)
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.cook_sessions%rowtype; pf uuid;
begin
  select * into s from public.cook_sessions where id=p_session_id;
  if s.id is null or not public.is_household_member(s.household_id) then raise exception 'Forbidden'; end if;
  if p_servings <= 0 then return null; end if;
  insert into public.prepared_foods(household_id,created_by,source_cook_session_id,name,servings_created,storage_location)
  values(s.household_id,auth.uid(),s.id,s.title,p_servings,p_storage_location) returning id into pf;
  insert into public.prepared_food_events(household_id,prepared_food_id,actor_user_id,event_type,serving_delta)
  values(s.household_id,pf,auth.uid(),'CREATED',p_servings);
  return pf;
end $$;
grant execute on function public.create_leftovers(uuid,numeric,text) to authenticated;

create or replace view public.prepared_food_projection
with (security_invoker=true) as
select pf.id as prepared_food_id,pf.household_id,pf.name,pf.storage_location,pf.prepared_at,pf.created_at,
       coalesce(sum(pfe.serving_delta),0) as servings_remaining
from public.prepared_foods pf
join public.prepared_food_events pfe on pfe.prepared_food_id=pf.id
group by pf.id,pf.household_id,pf.name,pf.storage_location,pf.prepared_at,pf.created_at;

grant select on public.prepared_food_projection to authenticated;

create or replace function public.eat_prepared_food(p_prepared_food_id uuid,p_servings numeric default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare pf public.prepared_foods%rowtype; remaining numeric; peid uuid; ieid uuid; fid uuid;
begin
  select * into pf from public.prepared_foods where id=p_prepared_food_id;
  if pf.id is null or not public.is_household_member(pf.household_id) then raise exception 'Forbidden'; end if;
  select coalesce(sum(serving_delta),0) into remaining from public.prepared_food_events where prepared_food_id=pf.id;
  if p_servings<=0 or p_servings>remaining then raise exception 'Invalid serving amount'; end if;
  insert into public.prepared_food_events(household_id,prepared_food_id,actor_user_id,event_type,serving_delta)
  values(pf.household_id,pf.id,auth.uid(),'CONSUMED',-p_servings) returning id into peid;
  fid:=public.ensure_food_concept(pf.name);
  insert into public.inventory_events(household_id,actor_user_id,event_type,food_concept_id,food_name,quantity_delta,unit,storage_location,confidence,metadata)
  values(pf.household_id,auth.uid(),'CONSUMPTION',fid,pf.name,-p_servings,'serving',pf.storage_location,'VERIFIED',
    jsonb_build_object('prepared_food_id',pf.id,'prepared_food_event_id',peid))
  returning id into ieid;
  return jsonb_build_object('prepared_event_id',peid,'event_id',ieid);
end $$;
grant execute on function public.eat_prepared_food(uuid,numeric) to authenticated;
