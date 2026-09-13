-- Save a recipe and its ingredient lines in ONE transaction.
-- Previously the app deleted all lines and re-inserted them in separate requests,
-- so any failure in between left the recipe with no ingredients.

create function public.save_recipe(p_recipe_id uuid, p_fields jsonb, p_lines jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := p_recipe_id;
begin
  if v_id is null then
    insert into recipes (title, servings, prep_minutes, cook_minutes, freezable, steps, source_url, notes)
    values (
      p_fields->>'title',
      (p_fields->>'servings')::int,
      (p_fields->>'prep_minutes')::int,
      (p_fields->>'cook_minutes')::int,
      coalesce((p_fields->>'freezable')::boolean, false),
      coalesce(array(select jsonb_array_elements_text(p_fields->'steps')), '{}'),
      p_fields->>'source_url',
      p_fields->>'notes'
    )
    returning id into v_id;
  else
    update recipes
       set title        = p_fields->>'title',
           servings     = (p_fields->>'servings')::int,
           prep_minutes = (p_fields->>'prep_minutes')::int,
           cook_minutes = (p_fields->>'cook_minutes')::int,
           freezable    = coalesce((p_fields->>'freezable')::boolean, false),
           steps        = coalesce(array(select jsonb_array_elements_text(p_fields->'steps')), '{}'),
           source_url   = p_fields->>'source_url',
           notes        = p_fields->>'notes'
     where id = v_id;
    if not found then
      raise exception 'Recipe not found';
    end if;
  end if;

  delete from recipe_ingredients where recipe_id = v_id;

  insert into recipe_ingredients (recipe_id, ingredient_id, quantity, unit, note, optional, position)
  select v_id,
         (l->>'ingredient_id')::uuid,
         (l->>'quantity')::numeric,
         l->>'unit',
         l->>'note',
         coalesce((l->>'optional')::boolean, false),
         (l->>'position')::int
    from jsonb_array_elements(p_lines) as l;

  return v_id;
end $$;
