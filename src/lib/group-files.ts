import type { StatusEntry } from "@/types";

export interface FileGroup {
  directory: string;
  files: StatusEntry[];
}

export function groupFilesByDirectory(entries: StatusEntry[]): FileGroup[] {
  const groupMap = new Map<string, StatusEntry[]>();

  for (const entry of entries) {
    const lastSlash = entry.path.lastIndexOf("/");
    const directory = lastSlash === -1 ? "" : entry.path.slice(0, lastSlash);

    let group = groupMap.get(directory);
    if (!group) {
      group = [];
      groupMap.set(directory, group);
    }
    group.push(entry);
  }

  const groups: FileGroup[] = Array.from(groupMap.entries()).map(
    ([directory, files]) => ({
      directory,
      files: files.sort((a, b) => {
        const nameA = a.path.slice(a.path.lastIndexOf("/") + 1);
        const nameB = b.path.slice(b.path.lastIndexOf("/") + 1);
        return nameA.localeCompare(nameB);
      }),
    })
  );

  groups.sort((a, b) => {
    if (a.directory === "") return -1;
    if (b.directory === "") return 1;
    return a.directory.localeCompare(b.directory);
  });

  return groups;
}
