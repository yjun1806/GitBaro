import { FolderGit2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorktreeIconProps {
  className?: string;
}

export function WorktreeIcon({ className }: WorktreeIconProps) {
  return (
    <FolderGit2 className={cn("text-muted-foreground shrink-0", className)} />
  );
}
