interface AgentSkillsProps {
  skills: string[];
}

export function AgentSkills({ skills }: AgentSkillsProps) {
  return (
    <div className="space-y-2">
      {skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No skills assigned</p>
      ) : (
        <ul className="space-y-1">
          {skills.map((skill) => (
            <li key={skill} className="text-sm">
              {skill}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Manage skills in the Skills section
      </p>
    </div>
  );
}
