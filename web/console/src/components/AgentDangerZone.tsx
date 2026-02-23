import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteAgent } from "@/api";

const SYSTEM_AGENTS = ["nova", "agent-builder"];

interface AgentDangerZoneProps {
  agentId: string;
  agentName: string;
}

export function AgentDangerZone({ agentId, agentName }: AgentDangerZoneProps) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const isSystem = SYSTEM_AGENTS.includes(agentId);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAgent(agentId);
      navigate("/web/console/agents");
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={deleting}>
            {deleting ? "Deleting..." : "Delete Agent"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {agentName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {agentName}? This action cannot be
              undone.
              {isSystem && (
                <>
                  <br />
                  <br />
                  <strong className="text-destructive">
                    Warning: This is a system agent. Deleting it may break core
                    functionality.
                  </strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
