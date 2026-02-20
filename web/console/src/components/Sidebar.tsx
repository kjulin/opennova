import { NavLink } from "react-router-dom";
import { Users, Wrench, Clock, KeyRound } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/skills", label: "Skills", icon: Wrench },
  { to: "/triggers", label: "Triggers", icon: Clock },
  { to: "/secrets", label: "Secrets", icon: KeyRound },
] as const;

export function Sidebar() {
  return (
    <aside className="flex h-screen w-60 flex-col border-r border-border bg-card sticky top-0">
      <div className="px-4 py-5">
        <h1 className="text-lg font-semibold tracking-tight">Nova</h1>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator />
      <div className="px-2 py-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
