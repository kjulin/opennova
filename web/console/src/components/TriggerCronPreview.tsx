import { cronToHuman, isValidCron } from "@/lib/cron";

interface TriggerCronPreviewProps {
  cron: string;
}

export function TriggerCronPreview({ cron }: TriggerCronPreviewProps) {
  if (!cron.trim()) return null;

  if (!isValidCron(cron)) {
    return (
      <p className="text-sm text-destructive">Invalid cron expression</p>
    );
  }

  const human = cronToHuman(cron);
  if (!human) return null;

  return (
    <p className="text-sm text-muted-foreground">→ {human}</p>
  );
}
