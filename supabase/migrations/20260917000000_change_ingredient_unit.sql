-- Switch the unit the pantry tracks an ingredient in (e.g. paprika: ml -> g).
-- Stock amounts are converted when the units are compatible; otherwise the old
-- amounts no longer mean anything, so they're reset (the caller then adds new stock).
create function public.change_ingredient_unit(p_ingredient_id uuid, p_unit text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_old text;
  v_factor numeric;
begin
  select unit into v_old from ingredients where id = p_ingredient_id;
  if v_old is null then
    raise exception 'Ingredient not found';
  end if;
  if v_old = p_unit then
    return;
  end if;

  v_factor := unit_factor(v_old, p_unit);

  update pantry_items
     set quantity       = case when quantity is null then null
                               when v_factor is null then 0
                               else quantity * v_factor end,
         usual_quantity = usual_quantity * v_factor,          -- null if not convertible
         updated_at     = now()
   where ingredient_id = p_ingredient_id;

  update shopping_extras
     set quantity = quantity * v_factor
   where ingredient_id = p_ingredient_id;

  update ingredients set unit = p_unit where id = p_ingredient_id;
end $$;
