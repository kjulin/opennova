import * as React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  titleClassName?: string;
}

export function CollapsibleCard({
  title,
  description,
  children,
  defaultOpen = false,
  className,
  titleClassName,
}: CollapsibleCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "bg-card text-card-foreground flex flex-col rounded-xl border shadow-sm",
          className,
        )}
      >
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-muted/50 rounded-xl transition-colors cursor-pointer"
          >
            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-90",
              )}
            />
            <div className="min-w-0">
              <div className={cn("font-semibold leading-none", titleClassName)}>
                {title}
              </div>
              {!open && (
                <div className="mt-1.5 text-sm text-muted-foreground truncate">
                  {description}
                </div>
              )}
            </div>
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className="px-6 pt-6 pb-6">{children}</div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
