import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSecret } from "@/api";

interface SecretAddFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

export function SecretAddForm({ onCreated, onCancel }: SecretAddFormProps) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!value.trim()) {
      setError("Value is required.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await createSecret(name.trim(), value);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create secret");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="SECRET_NAME"
            className="font-mono flex-1"
            autoFocus
          />
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Secret value"
            className="flex-1"
          />
          <Button type="submit" disabled={creating}>
            {creating ? "Adding..." : "Add"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </form>
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
