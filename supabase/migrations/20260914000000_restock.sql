-- Running out: items stay in the pantry at quantity 0 ("ran out" list) and can
-- put themselves on the shopping list automatically.

alter table public.pantry_items
  add column auto_restock   boolean not null default false,
  add column usual_quantity numeric check (usual_quantity is null or usual_quantity > 0);  -- last amount bought

update public.pantry_items set usual_quantity = quantity where quantity > 0;

-- Manual list items are now always tied to an ingredient (so they have a unit).
-- Legacy free-text rows keep working with ingredient_id null.

-- ---------------------------------------------------------------------------
-- add_stock: remembers the usual amount, optionally sets auto-restock, and
-- clears manual shopping-list entries for that ingredient (you've got it now).
-- ---------------------------------------------------------------------------
drop function public.add_stock(uuid, numeric, text);

create function public.add_stock(
  p_ingredient_id uuid,
  p_amount numeric,
  p_location text default null,
  p_auto_restock boolean default null
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into pantry_items (ingredient_id, quantity, location, usual_quantity, auto_restock)
  values (
    p_ingredient_id,
    p_amount,
    coalesce(p_location, 'pantry'),
    case when p_amount > 0 then p_amount end,
    coalesce(p_auto_restock, false)
  )
  on conflict (ingredient_id) do update
    set quantity = case
                     when pantry_items.quantity is null or excluded.quantity is null then null
                     else pantry_items.quantity + excluded.quantity
                   end,
        usual_quantity = coalesce(excluded.usual_quantity, pantry_items.usual_quantity),
        auto_restock   = coalesce(p_auto_restock, pantry_items.auto_restock),
        location       = coalesce(p_location, pantry_items.location),
        updated_at     = now();

  delete from shopping_extras where ingredient_id = p_ingredient_id;
end $$;

-- ---------------------------------------------------------------------------
-- Shopping list = planned recipe shortfalls + auto-restock + manual items,
-- merged per ingredient.
-- ---------------------------------------------------------------------------
drop view public.shopping_list;

create view public.shopping_list with (security_invoker = true) as
with demand as (
  select ri.ingredient_id, ri.quantity * pm.batches as qty, ri.quantity is null as untracked,
         r.title as recipe, 'plan' as source
  from public.planned_meals pm
  join public.recipes r             on r.id = pm.recipe_id
  join public.recipe_ingredients ri on ri.recipe_id = pm.recipe_id
  where not ri.optional

  union all
  select e.ingredient_id, e.quantity, e.quantity is null, null, 'manual'
  from public.shopping_extras e
  where e.ingredient_id is not null

  union all
  select p.ingredient_id, p.usual_quantity, p.usual_quantity is null, null, 'restock'
  from public.pantry_items p
  where p.auto_restock and p.quantity is not null and p.quantity <= 0
),
agg as (
  select
    ingredient_id,
    sum(qty)       filter (where source = 'plan')    as planned_need,
    bool_or(source = 'plan')                          as planned,
    sum(qty)       filter (where source = 'manual')  as manual_qty,
    bool_or(source = 'manual')                        as manual,
    max(qty)       filter (where source = 'restock') as restock_qty,
    bool_or(source = 'restock')                       as restock,
    coalesce(array_agg(distinct recipe) filter (where recipe is not null), '{}') as for_recipes
  from demand
  group by ingredient_id
),
calc as (
  select
    a.*,
    p.id as pantry_id,
    p.quantity as on_hand,
    -- planned recipes need more than I have? (untracked stock always counts as enough)
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
  -- greatest() ignores nulls; null overall means "some, amount unknown"
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
