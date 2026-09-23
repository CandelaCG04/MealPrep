-- "Running low": an item can reach the shopping list before it hits zero.
-- low_at is the level at which it counts as low (null = only when it runs out).

alter table public.pantry_items
  add column low_at numeric check (low_at is null or low_at >= 0);

-- Same list as before; the restock branch now fires at the low level, not only at 0.
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
  where p.auto_restock and p.quantity is not null and p.quantity <= coalesce(p.low_at, 0)
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
