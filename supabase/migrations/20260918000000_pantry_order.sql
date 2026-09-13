-- Manual ordering of pantry items (drag and drop).

alter table public.pantry_items add column position int not null default 0;

-- Start from the current alphabetical order within each category.
update public.pantry_items p
   set position = s.rn
  from (
    select p.id, row_number() over (partition by p.user_id, i.category order by i.name) - 1 as rn
      from public.pantry_items p
      join public.ingredients i on i.id = p.ingredient_id
  ) s
 where p.id = s.id;

-- New items go to the end.
create function public.pantry_items_set_position()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select coalesce(max(position) + 1, 0) into new.position
    from pantry_items where user_id = new.user_id;
  return new;
end $$;

create trigger pantry_items_position
  before insert on public.pantry_items
  for each row execute function public.pantry_items_set_position();

-- Save a category's order after a drag; items dropped in from another
-- category take on this category.
create function public.reorder_pantry(p_category text, p_item_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  update pantry_items p
     set position = t.ord - 1
    from unnest(p_item_ids) with ordinality as t(id, ord)
   where p.id = t.id;

  update ingredients i
     set category = p_category
    from pantry_items p
   where p.id = any(p_item_ids)
     and i.id = p.ingredient_id
     and i.category <> p_category;
end $$;
