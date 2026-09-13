-- Cooking can also mark ingredients as run out, in the same transaction.
-- Used for things the app can't deduct by amount (untracked "some" stock,
-- "to taste" lines, units that don't convert): the app asks, you tick what ran out.

drop function public.cook_recipe(uuid, numeric, int);

create function public.cook_recipe(
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

  -- What you told us ran out (quantity 0 = "Ran out"; auto-restock picks it up).
  if coalesce(array_length(p_ran_out, 1), 0) > 0 then
    update pantry_items
       set quantity = 0, updated_at = now()
     where ingredient_id = any(p_ran_out);
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
