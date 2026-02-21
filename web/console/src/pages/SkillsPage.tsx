import { useEffect, useState } from "react";
import { fetchSkills, fetchSkill, fetchAgents } from "@/api";
import { SkillList } from "@/components/SkillList";
import { SkillDrawer } from "@/components/SkillDrawer";
import { Button } from "@/components/ui/button";
import type { Skill, Agent } from "@/types";

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  function loadSkills() {
    return fetchSkills()
      .then((data) => setSkills(data.skills))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    Promise.all([
      fetchSkills().then((data) => setSkills(data.skills)),
      fetchAgents().then((data) => setAgents(data.agents)),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelectSkill(skill: Skill) {
    try {
      const detail = await fetchSkill(skill.name);
      setSelectedSkill(detail);
      setDrawerOpen(true);
    } catch {
      setError("Failed to load skill details");
    }
  }

  function handleCreateClick() {
    setSelectedSkill(null);
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
          {!loading && !error && (
            <p className="text-sm text-muted-foreground">
              {skills.length} skill{skills.length !== 1 && "s"}
            </p>
          )}
        </div>
        <Button onClick={handleCreateClick}>+ Create skill</Button>
      </div>

      {loading && (
        <div className="flex justify-center py-16 text-muted-foreground">
          Loading...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && skills.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          No skills configured.
        </div>
      )}

      {!loading && !error && skills.length > 0 && (
        <SkillList skills={skills} onSelect={handleSelectSkill} />
      )}

      <SkillDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        skill={selectedSkill}
        allAgents={agents}
        onCreated={() => {
          loadSkills();
        }}
        onDeleted={() => {
          loadSkills();
        }}
        onUpdated={() => {
          loadSkills();
        }}
      />
    </div>
  );
}
