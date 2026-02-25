import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AgentsPage } from "@/pages/AgentsPage";
import { AgentDetailPage } from "@/pages/AgentDetailPage";
import { SkillsPage } from "@/pages/SkillsPage";
import { TriggersPage } from "@/pages/TriggersPage";
import { SecretsPage } from "@/pages/SecretsPage";
import { ConfigPage } from "@/pages/ConfigPage";
import { DashboardPage } from "@/pages/DashboardPage";

const router = createBrowserRouter([
  {
    path: "/web/console",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "agents", element: <AgentsPage /> },
      { path: "agents/:id", element: <AgentDetailPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "triggers", element: <TriggersPage /> },
      { path: "secrets", element: <SecretsPage /> },
      { path: "config", element: <ConfigPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
