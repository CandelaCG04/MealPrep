-- "Made from": an ingredient can come out of another one, e.g.
--   30 ml Lime juice  <-  1 pc Limes
-- If you don't have (enough of) the ingredient itself, having the source counts;
-- the shopping list asks for the source; cooking uses up the source for the rest.

create table public.ingredient_sources (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users on delete cascade,
  ingredient_id         uuid not null unique references public.ingredients on delete cascade,
  amount                numeric not null check (amount > 0),
  unit                  text not null,
  source_ingredient_id  uuid not null references public.ingredients on delete cascade,
  source_amount         numeric not null check (source_amount > 0),
  source_unit           text not null,
  created_at            timestamptz not null default now(),
  check (source_ingredient_id <> ingredient_id)
);

create index on public.ingredient_sources (source_ingredient_id);

alter table public.ingredient_sources enable row level security;
create policy "own rows" on public.ingredient_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- How many pantry units of the source one pantry unit of the ingredient needs.
-- e.g. Lime juice (stock ml) <- Limes (stock pc) with "30 ml = 1 pc": factor 1/30.
-- NULL when the units in the relation can't be converted to the pantry units.
create view public.ingredient_source_factor with (security_invoker = true) as
select
  s.ingredient_id,
  s.source_ingredient_id,
  src.name as source_name,
  src.unit as source_stock_unit,
  public.ingredient_unit_factor(s.ingredient_id, i.unit, s.unit)
    * s.source_amount / s.amount
    * public.ingredient_unit_factor(s.source_ingredient_id, s.source_unit, src.unit) as factor
from public.ingredient_sources s
join public.ingredients i   on i.id = s.ingredient_id
join public.ingredients src on src.id = s.source_ingredient_id;

-- ---------------------------------------------------------------------------
-- Recipe lines: `have` now also counts the source. New columns are appended
-- (create or replace keeps the existing column order).
-- ---------------------------------------------------------------------------
create or replace view public.recipe_ingredient_status with (security_invoker = true) as
with base as (
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
    end as own_have
  from public.recipe_ingredients ri
  join public.ingredients i on i.id = ri.ingredient_id
  cross join lateral (select public.ingredient_unit_factor(ri.ingredient_id, ri.unit, i.unit) as f) uf
  left join public.pantry_items p on p.ingredient_id = ri.ingredient_id
),
with_source as (
  select
    b.*,
    sf.source_name,
    sf.source_stock_unit,
    sf.factor as source_factor,
    sp.id as source_pantry_id,
    sp.quantity as source_on_hand,
    -- what's still missing of the ingredient itself (pantry units); null = unknown amount
    case
      when b.stock_quantity is null then null
      else greatest(b.stock_quantity - greatest(coalesce(b.on_hand, 0), 0), 0)
    end as own_short
  from base b
  left join public.ingredient_source_factor sf on sf.ingredient_id = b.ingredient_id
  left join public.pantry_items sp on sp.ingredient_id = sf.source_ingredient_id
)
select
  id, recipe_id, ingredient_id, name, unit, stock_unit, category, quantity, stock_quantity,
  note, optional, position, on_hand, in_pantry,
  (own_have or coalesce(via_source, false)) as have,
  source_name,
  source_stock_unit as source_unit,
  source_needed,
  source_on_hand,
  (not own_have and coalesce(via_source, false)) as have_via_source,
  source_factor,                                  -- source pantry units per pantry unit of this ingredient
  (source_pantry_id is not null) as source_in_pantry
from (
  select
    w.*,
    case when not w.own_have and w.source_name is not null then w.own_short * w.source_factor end as source_needed,
    case
      when w.own_have or w.source_name is null or w.source_pantry_id is null then false
      when w.source_on_hand is null then true                                   -- untracked source: enough
      when w.source_on_hand <= 0 then false
      when w.own_short is null or w.source_factor is null then true             -- unknown amount: having some counts
      else w.source_on_hand >= w.own_short * w.source_factor
    end as via_source
  from with_source w
) x;

-- ---------------------------------------------------------------------------
-- Shopping list: shortfalls of ingredients that have a source are bought as the source.
-- ---------------------------------------------------------------------------
create or replace view public.shopping_list with (security_invoker = true) as
with plan_need as (
  select s.ingredient_id,
         sum(s.stock_quantity * pm.batches) as qty,
         bool_or(s.stock_quantity is null)  as has_unknown,
         array_agg(distinct r.title)        as recipes
  from public.planned_meals pm
  join public.recipes r                   on r.id = pm.recipe_id
  join public.recipe_ingredient_status s  on s.recipe_id = pm.recipe_id
  where not s.optional
  group by s.ingredient_id
),
plan_split as (
  select pn.*, sf.source_ingredient_id, sf.factor, p.id as pantry_id, p.quantity as on_hand
  from plan_need pn
  left join public.ingredient_source_factor sf on sf.ingredient_id = pn.ingredient_id
  left join public.pantry_items p on p.ingredient_id = pn.ingredient_id
),
demand as (
  -- ingredients without a source: as before
  select ingredient_id, qty, recipes, 'plan' as source
  from plan_split where source_ingredient_id is null

  union all
  -- ingredients with a source: whatever the pantry is short of, converted to the source
  select source_ingredient_id,
         case
           when qty is null or factor is null then null
           else greatest(qty - greatest(coalesce(on_hand, 0), 0), 0) * factor
         end,
         recipes, 'plan'
  from plan_split
  where source_ingredient_id is not null
    and not (pantry_id is not null and on_hand is null)                   -- untracked stock of the ingredient covers it
    and (pantry_id is null or on_hand <= 0 or qty is null or qty > on_hand)

  union all
  select e.ingredient_id, e.quantity, '{}'::text[], 'manual'
  from public.shopping_extras e
  where e.ingredient_id is not null

  union all
  select p.ingredient_id, p.usual_quantity, '{}'::text[], 'restock'
  from public.pantry_items p
  where p.auto_restock and p.quantity is not null and p.quantity <= 0
),
agg as (
  select
    d.ingredient_id,
    sum(d.qty)  filter (where d.source = 'plan')    as planned_need,
    bool_or(d.source = 'plan')                       as planned,
    sum(d.qty)  filter (where d.source = 'manual')  as manual_qty,
    bool_or(d.source = 'manual')                     as manual,
    max(d.qty)  filter (where d.source = 'restock') as restock_qty,
    bool_or(d.source = 'restock')                    as restock,
    coalesce((select array_agg(distinct t) from demand d2, unnest(d2.recipes) t where d2.ingredient_id = d.ingredient_id), '{}') as for_recipes
  from demand d
  group by d.ingredient_id
),
calc as (
  select
    a.*,
    p.quantity as on_hand,
    a.planned and (
      p.id is null
      or (p.quantity is not null and (p.quantity <= 0 or a.planned_need > p.quantity))
    ) as planned_short
  from agg a
  left join public.pantry_items p on p.ingredient_id = a.ingredient_id
)
select
  c.ingredient_id,
  i.name,
  i.unit,
  i.category,
  c.planned_need as needed,
  c.on_hand,
  greatest(
    case when c.planned_short then c.planned_need - coalesce(c.on_hand, 0) end,
    c.manual_qty,
    c.restock_qty
  ) as to_buy,
  c.for_recipes,
  c.planned_short,
  c.manual,
  c.restock
from calc c
join public.ingredients i on i.id = c.ingredient_id
where c.planned_short or c.manual or c.restock;

-- ---------------------------------------------------------------------------
-- Cooking: use the ingredient itself first, then take the rest from its source.
-- ---------------------------------------------------------------------------
create or replace function public.cook_recipe(p_recipe_id uuid, p_batches numeric default 1, p_freeze_portions int default 0)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_title text;
  v_plan uuid;
  r record;
  v_take numeric;
  v_rest numeric;
begin
  select title into v_title from recipes where id = p_recipe_id;
  if v_title is null then
    raise exception 'Recipe not found';
  end if;

  for r in
    select s.ingredient_id, s.stock_quantity * p_batches as need, s.in_pantry, s.on_hand,
           sf.source_ingredient_id, sf.factor
      from recipe_ingredient_status s
      left join ingredient_source_factor sf on sf.ingredient_id = s.ingredient_id
     where s.recipe_id = p_recipe_id
       and s.stock_quantity is not null
  loop
    if r.in_pantry and r.on_hand is null then
      v_take := r.need;                                   -- untracked stock covers it; nothing to deduct
    elsif r.in_pantry then
      v_take := least(r.need, greatest(r.on_hand, 0));
      update pantry_items
         set quantity = greatest(quantity - r.need, 0), updated_at = now()
       where ingredient_id = r.ingredient_id;
    else
      v_take := 0;
    end if;

    v_rest := r.need - v_take;
    if v_rest > 0 and r.source_ingredient_id is not null and r.factor is not null then
      update pantry_items
         set quantity = greatest(quantity - v_rest * r.factor, 0), updated_at = now()
       where ingredient_id = r.source_ingredient_id
         and quantity is not null;
    end if;
  end loop;

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
