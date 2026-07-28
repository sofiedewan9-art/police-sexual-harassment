"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { submitCorrection, type CorrectionState } from "./actions";

function CorrectionsForm() {
  const params = useSearchParams();
  const [state, formAction, pending] = useActionState<CorrectionState, FormData>(
    submitCorrection,
    null
  );

  const input = "w-full rounded border border-navy/20 bg-white px-3 py-2 text-sm";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Request a correction</h1>
        <p className="mt-2 text-ink/80">
          If you represent an agency or a party to a case and believe a record is inaccurate or
          incomplete, tell us here. Every request is reviewed by a person, and records are checked
          against their cited sources.
        </p>
      </div>

      {state?.ok ? (
        <div className="rounded-lg border border-brand bg-brand/5 p-6 text-navy">{state.message}</div>
      ) : (
        <form action={formAction} className="space-y-4 rounded-lg border border-navy/10 bg-white p-6">
          <input type="text" name="website" className="hidden" tabIndex={-1} autoComplete="off" />
          <label className="block text-sm font-medium text-navy">
            Record (optional)
            <input
              type="text" name="record" defaultValue={params.get("record") ?? ""}
              placeholder="Link or record name" className={`${input} mt-1`}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-navy">
              Your name (optional)
              <input type="text" name="name" className={`${input} mt-1`} />
            </label>
            <label className="block text-sm font-medium text-navy">
              Email (optional, for follow-up)
              <input type="email" name="email" className={`${input} mt-1`} />
            </label>
          </div>
          <label className="block text-sm font-medium text-navy">
            Organization (optional)
            <input type="text" name="organization" className={`${input} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-navy">
            What should be reviewed? *
            <textarea name="message" required rows={6} className={`${input} mt-1`} />
          </label>
          {state && !state.ok && <p className="text-sm text-red-700">{state.message}</p>}
          <button
            type="submit" disabled={pending}
            className="rounded bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {pending ? "Sending…" : "Submit request"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function CorrectionsPage() {
  return (
    <Suspense>
      <CorrectionsForm />
    </Suspense>
  );
}
