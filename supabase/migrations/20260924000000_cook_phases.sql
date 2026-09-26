-- Timing a cook: you toggle between prepping / waiting / cooking, each stretch is banked
-- into that phase, and finishing writes one row to cook_log. Averages come from that log.
-- Also: finished portions can go to the fridge as a "cooked meal" pantry item.

alter table public.cooking_sessions
  add column phase             text check (phase in ('prep', 'wait', 'cook')),
  add column phase_started_at  timestamptz,
  add column prep_seconds      int not null default 0,
  add column wait_seconds      int not null default 0,
  add column cook_seconds      int not null default 0;

create table public.cook_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id     uuid not null references public.recipes on delete cascade,
  cooked_at     timestamptz not null default now(),
  batches       numeric not null default 1,
  prep_seconds  int not null default 0,
  wait_seconds  int not null default 0,
  cook_seconds  int not null default 0
);

create index on public.cook_log (user_id, recipe_id);

alter table public.cook_log enable row level security;
create policy "own rows" on public.cook_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Switch phase (or pass null to pause): banks the time spent in the phase you were in.
create function public.set_cooking_phase(p_session uuid, p_phase text)
returns void
language plpgsql
set search_path = public
as $$
declare
  s record;
  v_elapsed int := 0;
begin
  select * into s from cooking_sessions where id = p_session;
  if s is null then
    raise exception 'Not cooking that right now';
  end if;
  if p_phase is not null and p_phase not in ('prep', 'wait', 'cook') then
    raise exception 'Unknown phase %', p_phase;
  end if;

  if s.phase is not null and s.phase_started_at is not null then
    v_elapsed := greatest(0, extract(epoch from now() - s.phase_started_at)::int);
  end if;

  update cooking_sessions
     set prep_seconds = prep_seconds + case when s.phase = 'prep' then v_elapsed else 0 end,
         wait_seconds = wait_seconds + case when s.phase = 'wait' then v_elapsed else 0 end,
         cook_seconds = cook_seconds + case when s.phase = 'cook' then v_elapsed else 0 end,
         phase = p_phase,
         phase_started_at = case when p_phase is null then null else now() end
   where id = p_session;
end $$;

-- How long this recipe usually takes you, per phase and in total.
create view public.recipe_time_stats with (security_invoker = true) as
select
  recipe_id,
  count(*)                                                            as cooks,
  round(avg(prep_seconds))::int                                       as avg_prep_seconds,
  round(avg(wait_seconds))::int                                       as avg_wait_seconds,
  round(avg(cook_seconds))::int                                       as avg_cook_seconds,
  round(avg(prep_seconds + wait_seconds + cook_seconds))::int         as avg_total_seconds,
  max(cooked_at)                                                      as last_cooked_at
from public.cook_log
group by recipe_id;

-- ---------------------------------------------------------------------------
-- Cooking: also banks the open phase, logs the run, and can put portions in the fridge.
-- ---------------------------------------------------------------------------
-- the extra parameter makes a new signature; drop the old one so calls stay unambiguous
drop function public.cook_recipe(uuid, numeric, int, uuid[]);

create function public.cook_recipe(
  p_recipe_id uuid,
  p_batches numeric default 1,
  p_freeze_portions int default 0,
  p_ran_out uuid[] default '{}',
  p_fridge_portions int default 0
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_title text;
  v_plan uuid;
  v_meal uuid;
  r record;
  s record;
  v_take numeric;
  v_rest numeric;
  v_elapsed int;
begin
  select title into v_title from recipes where id = p_recipe_id;
  if v_title is null then
    raise exception 'Recipe not found';
  end if;

  for r in
    select s2.ingredient_id, s2.stock_quantity * p_batches as need, s2.in_pantry, s2.on_hand,
           sf.source_ingredient_id, sf.factor
      from recipe_ingredient_status s2
      left join ingredient_source_factor sf on sf.ingredient_id = s2.ingredient_id
     where s2.recipe_id = p_recipe_id
       and s2.stock_quantity is not null
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

  if coalesce(array_length(p_ran_out, 1), 0) > 0 then
    update pantry_items
       set quantity = 0, updated_at = now()
     where ingredient_id = any(p_ran_out);
  end if;

  -- Leftovers in the fridge: a "cooked meal" pantry item named after the recipe.
  if coalesce(p_fridge_portions, 0) > 0 then
    v_meal := ensure_ingredient(v_title, 'portion', 'cooked');
    perform add_stock(v_meal, p_fridge_portions::numeric);
  end if;

  -- Close the timing session: bank the phase still running and log the run.
  select * into s from cooking_sessions where recipe_id = p_recipe_id;
  if s.id is not null then
    v_elapsed := case
                   when s.phase is not null and s.phase_started_at is not null
                   then greatest(0, extract(epoch from now() - s.phase_started_at)::int)
                   else 0
                 end;
    if s.prep_seconds + s.wait_seconds + s.cook_seconds + v_elapsed > 0 then
      insert into cook_log (recipe_id, batches, prep_seconds, wait_seconds, cook_seconds)
      values (
        p_recipe_id,
        s.batches,
        s.prep_seconds + case when s.phase = 'prep' then v_elapsed else 0 end,
        s.wait_seconds + case when s.phase = 'wait' then v_elapsed else 0 end,
        s.cook_seconds + case when s.phase = 'cook' then v_elapsed else 0 end
      );
    end if;
    delete from cooking_sessions where id = s.id;
  end if;

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
