import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ToastProvider } from "./components/ui/toast.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { BoardPage } from "./pages/BoardPage.tsx";
import { BoardsPage } from "./pages/BoardsPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { usePathname, useRoute } from "./router.tsx";
import { SessionProvider } from "./session.tsx";

export function App() {
  // A new page starts without the error of the page before it.
  const pathname = usePathname();
  return (
    <SessionProvider>
      <ToastProvider>
        <TooltipProvider delayDuration={400}>
          <ErrorBoundary key={pathname}>
            <Page />
          </ErrorBoundary>
        </TooltipProvider>
      </ToastProvider>
    </SessionProvider>
  );
}

function Page() {
  const route = useRoute();
  switch (route.name) {
    case "boards":
      return <BoardsPage />;
    case "board":
      return <BoardPage key={route.id} id={route.id} />;
    case "not-found":
      return <NotFoundPage />;
  }
}
