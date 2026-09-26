-- Buy a different amount than the list worked out, decided before you shop.
-- The list stays derived; an override only changes how much of a row you mean to buy.

create table if not exists public.shopping_overrides (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete cascade,
  quantity numeric not null check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, ingredient_id)
);

alter table public.shopping_overrides enable row level security;

drop policy if exists "own shopping overrides" on public.shopping_overrides;
create policy "own shopping overrides" on public.shopping_overrides
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant all on public.shopping_overrides to authenticated;

-- Same list as before, with `to_buy` honouring the override and `suggested` keeping
-- the worked-out amount so the app can show what it would have said.
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
  select ingredient_id, qty, recipes, 'plan' as source
  from plan_split where source_ingredient_id is null

  union all
  select source_ingredient_id,
         case
           when qty is null or factor is null then null
           else greatest(qty - greatest(coalesce(on_hand, 0), 0), 0) * factor
         end,
         recipes, 'plan'
  from plan_split
  where source_ingredient_id is not null
    and not (pantry_id is not null and on_hand is null)
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
),
listed as (
  select
    c.*,
    greatest(
      case when c.planned_short then c.planned_need - coalesce(c.on_hand, 0) end,
      c.manual_qty,
      c.restock_qty
    ) as suggested
  from calc c
)
select
  l.ingredient_id,
  i.name,
  i.unit,
  i.category,
  l.planned_need as needed,
  l.on_hand,
  coalesce(o.quantity, l.suggested) as to_buy,
  l.for_recipes,
  l.planned_short,
  l.manual,
  l.restock,
  l.suggested,
  o.quantity is not null as adjusted
from listed l
join public.ingredients i on i.id = l.ingredient_id
-- RLS already limits overrides to the current user.
left join public.shopping_overrides o on o.ingredient_id = l.ingredient_id
where l.planned_short or l.manual or l.restock;

-- Set or clear the adjusted amount for one ingredient.
create or replace function public.set_buy_amount(p_ingredient_id uuid, p_amount numeric)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_amount is null then
    delete from shopping_overrides where ingredient_id = p_ingredient_id;
  else
    insert into shopping_overrides (ingredient_id, quantity)
    values (p_ingredient_id, p_amount)
    on conflict (user_id, ingredient_id)
      do update set quantity = excluded.quantity, updated_at = now();
  end if;
end;
$$;

grant execute on function public.set_buy_amount(uuid, numeric) to authenticated;
