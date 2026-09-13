-- 1. Recipe lines can use their own unit (1 tbsp oil while the pantry stores oil in l).
-- 2. Instructions become an ordered list of steps.
-- 3. Separate prep and cook time.

-- ---------------------------------------------------------------------------
-- Unit conversion. Returns the multiplier from p_from to p_to, or null when the
-- units measure different things (e.g. tbsp -> g, clove -> pc).
-- ---------------------------------------------------------------------------
create function public.unit_factor(p_from text, p_to text)
returns numeric
language sql
immutable
as $$
  with u(unit, dim, factor) as (
    values ('g', 'mass', 1), ('kg', 'mass', 1000),
           ('ml', 'volume', 1), ('l', 'volume', 1000),
           ('tsp', 'volume', 5), ('tbsp', 'volume', 15), ('cup', 'volume', 240)
  )
  select case
    when p_from = p_to then 1::numeric
    else (select f.factor::numeric / t.factor
            from u f join u t on t.dim = f.dim
           where f.unit = p_from and t.unit = p_to)
  end
$$;

alter table public.recipe_ingredients add column unit text;
update public.recipe_ingredients ri set unit = i.unit from public.ingredients i where i.id = ri.ingredient_id;
alter table public.recipe_ingredients alter column unit set not null;

alter table public.recipes
  add column steps text[] not null default '{}',
  add column cook_minutes int check (cook_minutes >= 0);

-- Existing free-text instructions -> steps (one per non-empty line, numbering stripped).
update public.recipes r
   set steps = coalesce((
     select array_agg(s.cleaned order by s.n)
       from (
         select n, regexp_replace(trim(line), '^(\d+\s*[.):-]|[-*•])\s*', '') as cleaned
           from unnest(regexp_split_to_array(r.instructions, E'\n')) with ordinality as t(line, n)
       ) s
      where s.cleaned <> ''
   ), '{}');

-- Views depend on the columns we're changing; rebuild them.
drop view public.recipe_summary;
drop view public.recipe_ingredient_status;
drop view public.shopping_list;

alter table public.recipes drop column instructions;

-- ---------------------------------------------------------------------------
create view public.recipe_ingredient_status with (security_invoker = true) as
select
  ri.id,
  ri.recipe_id,
  ri.ingredient_id,
  i.name,
  ri.unit,                                   -- unit used in the recipe
  i.unit as stock_unit,                      -- unit the pantry tracks
  i.category,
  ri.quantity,                               -- in ri.unit
  ri.quantity * uf.f as stock_quantity,      -- in stock_unit; null if not convertible
  ri.note,
  ri.optional,
  ri.position,
  p.quantity as on_hand,
  (p.id is not null) as in_pantry,
  case
    when p.id is null                                 then false
    when p.quantity is null                           then true   -- untracked stock: assume enough
    when p.quantity <= 0                              then false
    when ri.quantity is null or uf.f is null          then true   -- "to taste" / can't compare units
    else p.quantity >= ri.quantity * uf.f
  end as have
from public.recipe_ingredients ri
join public.ingredients i on i.id = ri.ingredient_id
cross join lateral (select public.unit_factor(ri.unit, i.unit) as f) uf
left join public.pantry_items p on p.ingredient_id = ri.ingredient_id;

create view public.recipe_summary with (security_invoker = true) as
select
  r.*,
  count(s.id) filter (where not s.optional)                  as required_count,
  count(s.id) filter (where not s.optional and not s.have)   as missing_count,
  exists (select 1 from public.planned_meals pm where pm.recipe_id = r.id) as planned
from public.recipes r
left join public.recipe_ingredient_status s on s.recipe_id = r.id
group by r.id;

-- Same as before, but recipe amounts are converted to the pantry unit first.
create view public.shopping_list with (security_invoker = true) as
with demand as (
  select s.ingredient_id, s.stock_quantity * pm.batches as qty, s.stock_quantity is null as untracked,
         r.title as recipe, 'plan' as source
  from public.planned_meals pm
  join public.recipes r                   on r.id = pm.recipe_id
  join public.recipe_ingredient_status s  on s.recipe_id = pm.recipe_id
  where not s.optional

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
-- Cooking deducts converted amounts; lines with unconvertible units are skipped.
-- ---------------------------------------------------------------------------
create or replace function public.cook_recipe(p_recipe_id uuid, p_batches numeric default 1, p_freeze_portions int default 0)
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
     set quantity = greatest(p.quantity - s.stock_quantity * p_batches, 0),
         updated_at = now()
    from recipe_ingredient_status s
   where s.recipe_id = p_recipe_id
     and s.ingredient_id = p.ingredient_id
     and s.stock_quantity is not null
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
