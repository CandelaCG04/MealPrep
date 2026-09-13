-- MealPrep schema
-- Every table is owned by a user (auth.uid()) and protected by RLS.
-- Quantities for an ingredient are always stored in that ingredient's own unit
-- (ingredients.unit), so "needed - on hand" is plain arithmetic.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Ingredient catalog
-- ---------------------------------------------------------------------------
create table public.ingredients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  name_key    text generated always as (lower(trim(name))) stored,
  unit        text not null default 'pc',          -- g, ml, pc, ...
  category    text not null default 'other',       -- produce, dairy, meat, pantry, spices, frozen, other
  created_at  timestamptz not null default now(),
  unique (user_id, name_key)
);

-- ---------------------------------------------------------------------------
-- What I have. One row per ingredient.
-- quantity NULL  = "have some, not tracking amount" (spices, oil) -> always enough
-- quantity 0     = out of stock
-- ---------------------------------------------------------------------------
create table public.pantry_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  ingredient_id  uuid not null unique references public.ingredients on delete cascade,
  quantity       numeric check (quantity is null or quantity >= 0),
  location       text not null default 'pantry' check (location in ('pantry', 'fridge', 'freezer')),
  expires_on     date,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------
create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  servings      int check (servings > 0),
  prep_minutes  int check (prep_minutes >= 0),
  instructions  text not null default '',
  source_url    text,
  notes         text,
  freezable     boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.recipe_ingredients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id      uuid not null references public.recipes on delete cascade,
  ingredient_id  uuid not null references public.ingredients on delete restrict,
  quantity       numeric check (quantity is null or quantity > 0),  -- NULL = "to taste"
  note           text,
  optional       boolean not null default false,
  position       int not null default 0,
  unique (recipe_id, ingredient_id)
);

-- ---------------------------------------------------------------------------
-- Planned meals: "I intend to cook this". Drives the shopping list.
-- ---------------------------------------------------------------------------
create table public.planned_meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id   uuid not null references public.recipes on delete cascade,
  batches     numeric not null default 1 check (batches > 0),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Frozen meals
-- ---------------------------------------------------------------------------
create table public.frozen_meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  recipe_id   uuid references public.recipes on delete set null,
  portions    int not null default 1 check (portions >= 0),
  frozen_on   date not null default current_date,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Manual shopping extras (things not tied to a planned recipe)
-- ---------------------------------------------------------------------------
create table public.shopping_extras (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  ingredient_id  uuid references public.ingredients on delete cascade,
  quantity       numeric check (quantity is null or quantity > 0),
  created_at     timestamptz not null default now()
);

create index on public.ingredients (user_id);
create index on public.pantry_items (user_id);
create index on public.recipes (user_id);
create index on public.recipe_ingredients (recipe_id);
create index on public.recipe_ingredients (ingredient_id);
create index on public.planned_meals (user_id);
create index on public.frozen_meals (user_id, frozen_on);
create index on public.shopping_extras (user_id);

-- ---------------------------------------------------------------------------
-- Row level security: users only see their own rows
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ingredients','pantry_items','recipes','recipe_ingredients',
                           'planned_meals','frozen_meals','shopping_extras']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Views (security_invoker so RLS of the caller applies)
-- ---------------------------------------------------------------------------

-- Per recipe ingredient: do I have enough?
create view public.recipe_ingredient_status with (security_invoker = true) as
select
  ri.id,
  ri.recipe_id,
  ri.ingredient_id,
  i.name,
  i.unit,
  i.category,
  ri.quantity,
  ri.note,
  ri.optional,
  ri.position,
  p.quantity as on_hand,
  (p.id is not null) as in_pantry,
  case
    when p.id is null                        then false
    when p.quantity is null                  then true   -- untracked amount: assume enough
    when p.quantity <= 0                     then false
    when ri.quantity is null                 then true   -- "to taste" and I have some
    else p.quantity >= ri.quantity
  end as have
from public.recipe_ingredients ri
join public.ingredients i on i.id = ri.ingredient_id
left join public.pantry_items p on p.ingredient_id = ri.ingredient_id;

-- Per recipe: how many required ingredients am I missing?
create view public.recipe_summary with (security_invoker = true) as
select
  r.*,
  count(s.id) filter (where not s.optional)                  as required_count,
  count(s.id) filter (where not s.optional and not s.have)   as missing_count,
  exists (select 1 from public.planned_meals pm where pm.recipe_id = r.id) as planned
from public.recipes r
left join public.recipe_ingredient_status s on s.recipe_id = r.id
group by r.id;

-- The shopping list: (sum needed across planned meals) - (on hand), when positive.
create view public.shopping_list with (security_invoker = true) as
with needed as (
  select
    ri.ingredient_id,
    sum(ri.quantity * pm.batches)              as needed,
    bool_or(ri.quantity is null)               as has_untracked_need,
    array_agg(distinct r.title order by r.title) as for_recipes
  from public.planned_meals pm
  join public.recipes r            on r.id = pm.recipe_id
  join public.recipe_ingredients ri on ri.recipe_id = pm.recipe_id
  where not ri.optional
  group by ri.ingredient_id
)
select
  n.ingredient_id,
  i.name,
  i.unit,
  i.category,
  n.needed,
  p.quantity as on_hand,
  case
    when n.needed is null then null
    else n.needed - coalesce(p.quantity, 0)
  end as to_buy,
  n.for_recipes
from needed n
join public.ingredients i on i.id = n.ingredient_id
left join public.pantry_items p on p.ingredient_id = n.ingredient_id
where
  case
    when p.id is not null and p.quantity is null then false          -- untracked stock: enough
    when p.id is null or p.quantity <= 0         then true
    when n.needed is not null and n.needed > p.quantity then true
    else false
  end;

-- ---------------------------------------------------------------------------
-- Functions (security invoker: RLS still applies)
-- ---------------------------------------------------------------------------

-- Find an ingredient by name (case-insensitive) or create it.
create function public.ensure_ingredient(p_name text, p_unit text default 'pc', p_category text default 'other')
returns uuid
language plpgsql
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from ingredients
   where user_id = auth.uid() and name_key = lower(trim(p_name));
  if v_id is null then
    insert into ingredients (name, unit, category)
    values (trim(p_name), coalesce(nullif(p_unit, ''), 'pc'), coalesce(nullif(p_category, ''), 'other'))
    on conflict (user_id, name_key) do update set name = excluded.name
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Add stock (e.g. after shopping). NULL amount = mark as "have, untracked".
create function public.add_stock(p_ingredient_id uuid, p_amount numeric, p_location text default null)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into pantry_items (ingredient_id, quantity, location)
  values (p_ingredient_id, p_amount, coalesce(p_location, 'pantry'))
  on conflict (ingredient_id) do update
    set quantity = case
                     when pantry_items.quantity is null or excluded.quantity is null then null
                     else pantry_items.quantity + excluded.quantity
                   end,
        location = coalesce(p_location, pantry_items.location),
        updated_at = now();
end $$;

-- Cook a recipe: deduct ingredients, remove one matching plan, optionally freeze portions.
create function public.cook_recipe(p_recipe_id uuid, p_batches numeric default 1, p_freeze_portions int default 0)
returns void
language plpgsql
set search_path = public
as $$
declare v_title text; v_plan uuid;
begin
  select title into v_title from recipes where id = p_recipe_id;
  if v_title is null then
    raise exception 'Recipe not found';
  end if;

  update pantry_items p
     set quantity = greatest(p.quantity - ri.quantity * p_batches, 0),
         updated_at = now()
    from recipe_ingredients ri
   where ri.recipe_id = p_recipe_id
     and ri.ingredient_id = p.ingredient_id
     and ri.quantity is not null
     and p.quantity is not null;

  select id into v_plan from planned_meals
   where recipe_id = p_recipe_id order by created_at limit 1;
  if v_plan is not null then
    delete from planned_meals where id = v_plan;
  end if;

  if coalesce(p_freeze_portions, 0) > 0 then
    insert into frozen_meals (name, recipe_id, portions)
    values (v_title, p_recipe_id, p_freeze_portions);
  end if;
end $$;
