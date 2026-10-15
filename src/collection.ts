import type { SdkCollectionNode, SdkHierarchicalCollection, SdkTaskProviderSnapshot } from "@asterlyn/plugin-sdk";

export const ANDROID_GRADLE_COLLECTION_PROVIDER_ID = "gradle-tasks";

interface ProjectBucket {
  readonly projectPath: string;
  readonly groups: Map<string, SdkTaskProviderSnapshot["tasks"]>;
}

/** Build the provider-owned semantic hierarchy; the host adds its workspace root and renders it. */
export function buildAndroidGradleTaskCollection(snapshot: SdkTaskProviderSnapshot): SdkHierarchicalCollection {
  const projects = new Map<string, ProjectBucket>();
  for (const task of snapshot.tasks) {
    const projectPath = taskProjectPath(task.id, task.projectPath);
    let project = projects.get(projectPath);
    if (!project) {
      project = { projectPath, groups: new Map() };
      projects.set(projectPath, project);
    }
    const group = task.group.trim() || "Other";
    project.groups.set(group, [...(project.groups.get(group) ?? []), task]);
  }

  const nodes: SdkCollectionNode[] = [];
  const orderedProjects = [...projects.values()].sort(compareProjects);
  orderedProjects.forEach((project, projectIndex) => {
    const projectId = project.projectPath === ":" ? "project.root" : stableId("project", project.projectPath);
    const tasksId = `${projectId}.tasks`;
    if (project.projectPath !== ":") {
      nodes.push({
        id: projectId,
        parentId: null,
        label: project.projectPath.slice(1) || project.projectPath,
        kind: "group",
        order: projectIndex,
        metadata: { "android.gradle.nodeKind": "module", "android.gradle.projectPath": project.projectPath },
      });
    }
    nodes.push({
      id: tasksId,
      parentId: project.projectPath === ":" ? null : projectId,
      label: "Tasks",
      kind: "group",
      order: project.projectPath === ":" ? projectIndex : 0,
      metadata: { "android.gradle.nodeKind": "tasks", "android.gradle.projectPath": project.projectPath },
    });
    [...project.groups.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .forEach(([group, tasks], groupIndex) => {
        const groupId = `${tasksId}.${stableId("group", group)}`;
        nodes.push({
          id: groupId,
          parentId: tasksId,
          label: groupLabel(group),
          kind: "group",
          order: groupIndex,
          metadata: { "android.gradle.nodeKind": "group", "android.gradle.group": group },
        });
        [...tasks].sort((left, right) => compareText(left.id, right.id)).forEach((task, taskIndex) => {
          nodes.push({
            id: `${groupId}.${stableId("task", task.id)}`,
            parentId: groupId,
            label: taskName(task.id, task.label),
            kind: "task",
            order: taskIndex,
            taskId: task.id,
            metadata: { "android.gradle.projectPath": project.projectPath, "android.gradle.group": group },
          });
        });
      });
  });
  return { providerId: ANDROID_GRADLE_COLLECTION_PROVIDER_ID, nodes, truncated: false };
}

function taskProjectPath(taskId: string, explicit: string | undefined): string {
  if (explicit && /^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?$/u.test(explicit)) return explicit;
  if (!taskId.startsWith(":")) return ":";
  const separator = taskId.lastIndexOf(":");
  return separator > 0 ? taskId.slice(0, separator) : ":";
}

function groupLabel(group: string): string {
  const trimmed = group.replace(/\s+tasks$/iu, "").trim() || group.trim() || "Other";
  return trimmed.charAt(0).toLocaleLowerCase() + trimmed.slice(1);
}

function taskName(id: string, fallback: string): string {
  const separator = id.lastIndexOf(":");
  const name = separator >= 0 ? id.slice(separator + 1) : id;
  return name || fallback;
}

function stableId(kind: string, value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${kind}.${hash.toString(16).padStart(16, "0")}`;
}

function compareProjects(left: ProjectBucket, right: ProjectBucket): number {
  if (left.projectPath === ":" && right.projectPath !== ":") return -1;
  if (right.projectPath === ":" && left.projectPath !== ":") return 1;
  return compareText(left.projectPath, right.projectPath);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}
