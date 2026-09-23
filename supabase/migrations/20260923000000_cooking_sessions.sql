-- Cooking something with a long wait (marinating, proving, resting): keep track of
-- where you are, so it survives closing the app.

create table public.cooking_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id   uuid not null references public.recipes on delete cascade,
  batches     numeric not null default 1 check (batches > 0),
  done_steps  int[] not null default '{}',   -- indexes of the steps ticked off
  wait_until  timestamptz,                   -- optional "back in 2 h" marker
  started_at  timestamptz not null default now(),
  unique (recipe_id)                          -- one session per recipe at a time
);

create index on public.cooking_sessions (user_id, started_at);

alter table public.cooking_sessions enable row level security;
create policy "own rows" on public.cooking_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Finishing a recipe clears its session, in the same transaction as the cooking itself.
create or replace function public.cook_recipe(
  p_recipe_id uuid,
  p_batches numeric default 1,
  p_freeze_portions int default 0,
  p_ran_out uuid[] default '{}'
)
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

  if coalesce(array_length(p_ran_out, 1), 0) > 0 then
    update pantry_items
       set quantity = 0, updated_at = now()
     where ingredient_id = any(p_ran_out);
  end if;

  delete from cooking_sessions where recipe_id = p_recipe_id;

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
