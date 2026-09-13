"use client";

import { useFormStatus } from "react-dom";

export function Submit({
  children,
  className = "btn-primary",
  pendingText,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || props.disabled} {...props}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
