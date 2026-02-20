import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AgentsPage } from "@/pages/AgentsPage";
import { SkillsPage } from "@/pages/SkillsPage";
import { TriggersPage } from "@/pages/TriggersPage";
import { SecretsPage } from "@/pages/SecretsPage";

const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="agents" replace /> },
        { path: "agents", element: <AgentsPage /> },
        { path: "agents/:id", element: <div>Agent detail (coming soon)</div> },
        { path: "skills", element: <SkillsPage /> },
        { path: "triggers", element: <TriggersPage /> },
        { path: "secrets", element: <SecretsPage /> },
      ],
    },
  ],
  { basename: "/web/console" }
);

export default function App() {
  return <RouterProvider router={router} />;
}
