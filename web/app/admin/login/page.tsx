import { login } from "./actions";

export const metadata = { title: "Admin login" };

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-16">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <form action={login} className="space-y-3 rounded-lg border border-navy/10 bg-white p-6">
        <input type="hidden" name="next" value={next ?? "/admin"} />
        <label className="block text-sm font-medium text-navy">
          Password
          <input
            type="password" name="password" required autoFocus
            className="mt-1 w-full rounded border border-navy/20 px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-700">Incorrect password.</p>}
        <button className="w-full rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          Sign in
        </button>
      </form>
    </div>
  );
}
