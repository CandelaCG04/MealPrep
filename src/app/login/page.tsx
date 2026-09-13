"use client";

import { useActionState } from "react";
import { authenticate, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(authenticate, {});

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <div className="text-4xl">🥘</div>
        <h1 className="h1 mt-2">MealPrep</h1>
        <p className="text-muted">Pantry, freezer, recipes and a shopping list that writes itself.</p>
      </div>

      <form action={action} className="card flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={6} required />
        </div>

        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.message && <p className="text-sm text-accent">{state.message}</p>}

        <button className="btn-primary" name="mode" value="signin" disabled={pending}>Sign in</button>
        <button className="btn-ghost" name="mode" value="signup" disabled={pending}>Create account</button>
      </form>
    </main>
  );
}
