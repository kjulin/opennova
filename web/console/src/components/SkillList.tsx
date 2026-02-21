import { Card, CardHeader, CardContent } from "@/components/ui/card";
import type { Skill } from "@/types";

interface SkillListProps {
  skills: Skill[];
  onSelect: (skill: Skill) => void;
}

export function SkillList({ skills, onSelect }: SkillListProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((skill) => (
        <button
          key={skill.name}
          type="button"
          onClick={() => onSelect(skill)}
          className="block h-full text-left"
        >
          <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50 flex flex-col">
            <CardHeader>
              <h3 className="font-semibold font-mono">{skill.name}</h3>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {skill.description || "No description"}
              </p>
              <p className="text-xs font-medium text-foreground/70 mt-auto">
                {skill.assignedTo.length > 0
                  ? `Assigned to: ${skill.assignedTo.join(", ")}`
                  : <span className="text-muted-foreground">Not assigned</span>}
              </p>
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  );
}
