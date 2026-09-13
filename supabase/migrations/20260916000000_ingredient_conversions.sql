-- Per-ingredient conversions for things that change form in recipes,
-- e.g. chicken broth powder: "250 ml (in recipes) = 5 g (from the pantry)".

create table public.ingredient_conversions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  ingredient_id  uuid not null references public.ingredients on delete cascade,
  unit           text not null,                                  -- unit as written in recipes
  amount         numeric not null check (amount > 0),
  equals_amount  numeric not null check (equals_amount > 0),
  equals_unit    text not null,                                  -- what that uses from the pantry
  created_at     timestamptz not null default now(),
  unique (ingredient_id, unit)
);

create index on public.ingredient_conversions (ingredient_id);

alter table public.ingredient_conversions enable row level security;
create policy "own rows" on public.ingredient_conversions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Only the metric pairs; used to let "250 ml = 5 g" also cover recipes written in l.
create function public.metric_factor(p_from text, p_to text)
returns numeric
language sql
immutable
as $$
  select case
    when p_from = p_to                  then 1::numeric
    when p_from = 'l'  and p_to = 'ml'  then 1000
    when p_from = 'ml' and p_to = 'l'   then 0.001
    when p_from = 'kg' and p_to = 'g'   then 1000
    when p_from = 'g'  and p_to = 'kg'  then 0.001
  end
$$;

-- Same unit -> 1; then the ingredient's own conversions; then standard conversions.
-- Keep in sync with ingredientFactor() in src/lib/types.ts.
create function public.ingredient_unit_factor(p_ingredient_id uuid, p_from text, p_to text)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(
    case when p_from = p_to then 1::numeric end,
    (select metric_factor(p_from, c.unit) * c.equals_amount / c.amount * unit_factor(c.equals_unit, p_to)
       from ingredient_conversions c
      where c.ingredient_id = p_ingredient_id
        and metric_factor(p_from, c.unit) is not null
        and unit_factor(c.equals_unit, p_to) is not null
      order by (c.unit = p_from) desc
      limit 1),
    unit_factor(p_from, p_to)
  )
$$;

-- Same columns as before; only the conversion changes.
create or replace view public.recipe_ingredient_status with (security_invoker = true) as
select
  ri.id,
  ri.recipe_id,
  ri.ingredient_id,
  i.name,
  ri.unit,
  i.unit as stock_unit,
  i.category,
  ri.quantity,
  ri.quantity * uf.f as stock_quantity,
  ri.note,
  ri.optional,
  ri.position,
  p.quantity as on_hand,
  (p.id is not null) as in_pantry,
  case
    when p.id is null                                 then false
    when p.quantity is null                           then true
    when p.quantity <= 0                              then false
    when ri.quantity is null or uf.f is null          then true
    else p.quantity >= ri.quantity * uf.f
  end as have
from public.recipe_ingredients ri
join public.ingredients i on i.id = ri.ingredient_id
cross join lateral (select public.ingredient_unit_factor(ri.ingredient_id, ri.unit, i.unit) as f) uf
left join public.pantry_items p on p.ingredient_id = ri.ingredient_id;
