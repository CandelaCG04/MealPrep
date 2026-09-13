# MealPrep 🥘

Pantry, freezer, recipes, and a shopping list that fills itself in. It's an installable PWA, so the same URL works on your laptop and your phone.

**Stack:** Next.js 16 + TypeScript + Tailwind · Supabase (Postgres, auth, RLS) · Vercel · Claude API (`claude-opus-5`) for importing recipes and quick-adding groceries.

## How the data works

The shopping list isn't stored anywhere. It's a SQL view:

```
shopping_list = Σ(recipe_ingredients × planned batches) − pantry on hand   (only rows where that's > 0)
```

| Action | What happens in the database |
| --- | --- |
| **Add missing to list** (on a recipe) | Inserts a `planned_meals` row. Anything you don't have enough of shows up on the list. |
| **Tick an item off** while shopping | Adds that amount to the pantry, so the item drops off the list. |
| **I cooked this** | `cook_recipe()` subtracts the ingredients from the pantry, clears one plan, and can add frozen portions. |
| **Extras** | Manual items that aren't tied to a recipe, like paper towels. |

Rules:
- Each ingredient has one unit (g, ml, pc…). Pantry and recipe amounts are always stored in that unit, so the math is simple subtraction. When Claude imports a recipe, it converts amounts into the units you already use.
- A blank pantry amount means "I have some, not tracking how much" (salt, oil). That always counts as enough.
- A blank recipe amount means "to taste". It only counts as missing if you have none.

The schema is in `supabase/migrations/`. Every table has row-level security, so each user only sees their own rows.

## Setup

1. **Supabase:** create a project at supabase.com, then apply the schema, either with the CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
   …or by pasting `supabase/migrations/20260913000000_init.sql` into the SQL Editor.
   In **Authentication → Sign In / Providers**, you can turn off "Confirm email" to make signup faster. Once your account exists, turn off "Allow new users to sign up".
2. **Env:** `cp .env.example .env.local` and fill in the Supabase URL, the publishable key, and `ANTHROPIC_API_KEY`.
3. **Run:** `npm run dev` → http://localhost:3000, then create your account.

## Deploy (Vercel)

Push to GitHub, import the repo in Vercel, and add the same three env vars. After that, every push deploys. To install the app on your phone, open the URL, then use Share → *Add to Home Screen* (iOS) or the menu → *Install app* (Android).

## Layout

```
src/proxy.ts                     auth gate + Supabase session refresh
src/lib/ai.ts                    Claude ingest (recipe from text/URL/photo, pantry from free text)
src/app/(app)/actions.ts         all server actions
src/app/(app)/{pantry,freezer,recipes,shopping}/
supabase/migrations/             schema, views, functions
```
