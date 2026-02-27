import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AgentsPage } from "@/pages/AgentsPage";
import { AgentDetailPage } from "@/pages/AgentDetailPage";
import { SkillsPage } from "@/pages/SkillsPage";
import { TriggersPage } from "@/pages/TriggersPage";
import { SecretsPage } from "@/pages/SecretsPage";
import { ConfigPage } from "@/pages/ConfigPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { UsagePage } from "@/pages/UsagePage";
import { PairPage } from "@/pages/PairPage";
import { isCloudMode, getCloudSession } from "@/lib/transport";

function CloudGuard({ children }: { children: React.ReactNode }) {
  if (isCloudMode() && !getCloudSession()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <div className="mb-4 text-2xl">Not connected</div>
          <p className="text-muted-foreground">
            Send /admin in Telegram to get a pairing link.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

const router = createBrowserRouter([
  {
    path: "/pair",
    element: <PairPage />,
  },
  {
    path: "/",
    element: (
      <CloudGuard>
        <AppShell />
      </CloudGuard>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "agents", element: <AgentsPage /> },
      { path: "agents/:id", element: <AgentDetailPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "triggers", element: <TriggersPage /> },
      { path: "secrets", element: <SecretsPage /> },
      { path: "config", element: <ConfigPage /> },
      { path: "usage", element: <UsagePage /> },
    ],
  },
]);

export default function App() {
  return (
    <RouterProvider router={router} />
  );
}
