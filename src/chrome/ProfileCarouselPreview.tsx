import { useLayoutEffect, useRef } from "react";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { ChevronDown, Folder, Plus } from "./icons";

export type WorkspaceProfilePreviewTask = {
  id: string;
  title: string;
  busy: boolean;
};

export type WorkspaceProfilePreviewData = {
  id: string;
  name: string;
  projects: readonly {
    path: string;
    name: string;
    tasks: readonly WorkspaceProfilePreviewTask[];
  }[];
  standaloneTasks: readonly WorkspaceProfilePreviewTask[];
};

const snapshotScroll = new WeakMap<
  HTMLElement,
  {
    node: HTMLElement;
    top: number;
    left: number;
  }[]
>();

/** Capture only sidebar markup, never a second React/session/browser tree. */
export function captureProfileSidebar(content: HTMLElement): HTMLElement {
  const snapshot = content.cloneNode(true) as HTMLElement;
  const originals = [content, ...content.querySelectorAll<HTMLElement>("*")];
  const copies = [snapshot, ...snapshot.querySelectorAll<HTMLElement>("*")];
  // Read all positions before writing. A detached clone cannot retain scroll
  // offsets until it is installed in its page, so save those for the host.
  const offsets = originals.flatMap((node, index) => {
    const top = node.scrollTop,
      left = node.scrollLeft;
    return top || left ? [{ node: copies[index], top, left }] : [];
  });
  const style = getComputedStyle(content);
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (/^--(?:personal-|color-|theme-)/.test(name))
      snapshot.style.setProperty(name, style.getPropertyValue(name));
  }
  snapshot.style.color = style.color;
  snapshot.classList.replace(
    "personal-profile-content",
    "personal-profile-snapshot",
  );
  for (const property of [
    "left",
    "right",
    "top",
    "bottom",
    "transform",
    "visibility",
  ])
    snapshot.style.removeProperty(property);
  snapshot.style.position = "relative";
  snapshot.style.width = "100%";
  snapshot.style.height = "100%";
  snapshot.setAttribute("inert", "");
  snapshot.setAttribute("aria-hidden", "true");
  for (const copy of copies) {
    copy.removeAttribute("id");
    copy.removeAttribute("autofocus");
    if (
      copy.matches(
        "button,input,select,textarea,a,[tabindex],[contenteditable]",
      )
    )
      copy.setAttribute("tabindex", "-1");
  }
  snapshotScroll.set(snapshot, offsets);
  return snapshot;
}

function SnapshotPreview({
  snapshot,
  profileId,
}: {
  snapshot: HTMLElement;
  profileId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(snapshot);
    for (const { node, top, left } of snapshotScroll.get(snapshot) ?? []) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    return () => host.replaceChildren();
  }, [snapshot]);
  return (
    <div
      ref={ref}
      className="personal-profile-preview-content flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-profile-preview={profileId}
      inert
      aria-hidden="true"
    />
  );
}

function PreviewTasks({
  tasks,
}: {
  tasks: readonly WorkspaceProfilePreviewTask[];
}) {
  return (
    <div className="personal-project-tasks">
      {tasks.map((task) => (
        <div key={task.id} className="personal-other-task personal-task-card">
          <span
            className={
              task.busy ? "personal-task-working-dot" : "personal-task-indent"
            }
          />
          <span className="personal-task-title">{task.title}</span>
        </div>
      ))}
    </div>
  );
}

/** Cached markup on revisits, or a data-only preview before the first visit. */
export function ProfileCarouselPreview({
  profile,
  preview,
  snapshot,
}: {
  profile: WorkspaceProfile;
  preview?: WorkspaceProfilePreviewData;
  snapshot?: HTMLElement;
}) {
  if (snapshot)
    return <SnapshotPreview snapshot={snapshot} profileId={profile.id} />;
  return (
    <div
      className="personal-profile-preview-content flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-profile-preview={profile.id}
      inert
      aria-hidden="true"
    >
      <div className="personal-new-session">
        <Plus className="size-3.5" />
        <span>New session</span>
      </div>
      <div className="personal-projects-scroll min-h-0 flex-1 overflow-hidden">
        {!!preview?.standaloneTasks.length && (
          <section className="personal-standalone-group">
            <div className="personal-projects-heading">
              <span>Sessions</span>
            </div>
            <PreviewTasks tasks={preview.standaloneTasks} />
          </section>
        )}
        <div className="personal-projects-heading">
          <span>Projects</span>
        </div>
        {preview?.projects.map((project) => (
          <section key={project.path} className="personal-project-group">
            <div className="personal-project-row">
              <div className="personal-project-open">
                <Folder
                  className="personal-project-symbol size-3.5"
                  strokeWidth={1.75}
                />
                <span>{project.name}</span>
              </div>
              {!!project.tasks.length && (
                <span className="personal-project-row-action personal-project-disclosure">
                  <ChevronDown className="size-3" />
                </span>
              )}
            </div>
            {!!project.tasks.length && <PreviewTasks tasks={project.tasks} />}
          </section>
        ))}
        {!preview?.projects.length && (
          <p className="personal-tasks-empty">
            Add a project to {profile.name}.
          </p>
        )}
      </div>
    </div>
  );
}
