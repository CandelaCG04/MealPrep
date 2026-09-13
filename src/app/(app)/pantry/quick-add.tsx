"use client";

import { useActionState } from "react";
import { quickAddPantry, type ActionState } from "../actions";

export function QuickAdd() {
  const [state, action, pending] = useActionState<ActionState, FormData>(quickAddPantry, {});

  return (
    <form action={action} className="card flex flex-col gap-2">
      <label className="label" htmlFor="quick">✨ Quick add</label>
      <textarea
        id="quick"
        name="text"
        rows={2}
        className="input"
        placeholder="2 kg chicken thighs, a dozen eggs, 500g spinach, soy sauce… or paste a receipt"
      />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Reading…" : "Add"}</button>
        {state.error && <span className="text-sm text-danger">{state.error}</span>}
        {state.message && <span className="text-sm text-accent">{state.message}</span>}
      </div>
    </form>
  );
}
