import { Link } from "../router.tsx";

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid justify-items-center gap-3 text-center">
        <h1 className="text-figure font-bold text-heading">This page does not exist</h1>
        <p className="text-subdued">The board may have been deleted.</p>
        <Link to="/" className="font-semibold text-accent hover:underline">
          All boards
        </Link>
      </div>
    </main>
  );
}
