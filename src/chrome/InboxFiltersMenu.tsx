import { Check, CircleDot, GitPullRequest } from "./icons";
import { type ReactNode } from "react";
import type { InboxKind } from "../lib/githubTasks";
import {
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  type InboxFilters,
  type InboxTimeFilter,
} from "../lib/inboxFilters";
import { Popover } from "./Popover";
import "./Menu.css";
import { ProjectLogoIcon } from "./ProjectLogoIcon";

export const INBOX_FILTER_MENU_WIDTH = 228;

type ProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
};

type Props = {
  /** The filter button. Pressing it again closes the menu, not reopens it. */
  anchor: HTMLElement;
  projects: ProjectOption[];
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
  onClose: () => void;
};

const TIME_OPTIONS: { id: InboxTimeFilter; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const KIND_OPTIONS: {
  id: InboxKind;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: "issue",
    label: "Issues",
    icon: <CircleDot className="size-3.5 shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "pr",
    label: "Pull requests",
    icon: <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} />,
  },
];

export function InboxFiltersMenu({
  anchor,
  projects,
  filters,
  onChange,
  onClose,
}: Props) {
  const hiddenProjects = new Set(filters.hiddenProjects);
  const hiddenKinds = new Set(filters.hiddenKinds);

  const toggleAssigned = () => {
    onChange({ ...filters, assignedToMe: !filters.assignedToMe });
  };

  const toggleKind = (kind: InboxKind) => {
    const next = new Set(hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onChange({ ...filters, hiddenKinds: [...next] });
  };

  const toggleProject = (path: string) => {
    const next = new Set(hiddenProjects);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onChange({ ...filters, hiddenProjects: [...next] });
  };

  const setTime = (time: InboxTimeFilter) => {
    onChange({ ...filters, time });
  };

  const toggleStatus = (key: keyof InboxFilters["status"]) => {
    onChange({
      ...filters,
      status: { ...filters.status, [key]: !filters.status[key] },
    });
  };

  return (
    <Popover
      anchor={anchor}
      align="end"
      gap={2}
      width={INBOX_FILTER_MENU_WIDTH}
      maxHeight={480}
      onDismiss={onClose}
      role="menu"
      aria-label="Filter inbox"
      onContextMenu={(event) => event.preventDefault()}
      className="aven-menu overflow-y-auto overscroll-none"
    >
      <FilterItem
        label="Assigned to me"
        checked={filters.assignedToMe}
        onClick={toggleAssigned}
      />

      <SectionLabel>Status</SectionLabel>
      <FilterItem
        label="Open"
        checked={filters.status.open}
        onClick={() => toggleStatus("open")}
      />
      <FilterItem
        label="Draft"
        checked={filters.status.draft}
        onClick={() => toggleStatus("draft")}
      />
      <FilterItem
        label="Closed"
        checked={filters.status.closed}
        onClick={() => toggleStatus("closed")}
      />
      <FilterItem
        label="Merged"
        checked={filters.status.merged}
        onClick={() => toggleStatus("merged")}
      />

      <SectionLabel>Time</SectionLabel>
      {TIME_OPTIONS.map((option) => (
        <FilterItem
          key={option.id}
          label={option.label}
          checked={filters.time === option.id}
          onClick={() => setTime(option.id)}
        />
      ))}

      <SectionLabel>Type</SectionLabel>
      {KIND_OPTIONS.map((option) => (
        <FilterItem
          key={option.id}
          label={option.label}
          checked={!hiddenKinds.has(option.id)}
          icon={option.icon}
          onClick={() => toggleKind(option.id)}
        />
      ))}

      {projects.length > 0 ? (
        <>
          <SectionLabel>Projects</SectionLabel>
          {projects.map((project) => (
            <FilterItem
              key={project.path}
              label={project.name}
              checked={!hiddenProjects.has(project.path)}
              icon={
                project.logoPath ? (
                  <ProjectLogoIcon
                    path={project.logoPath}
                    className="size-3.5 shrink-0 rounded-sm"
                    imageClassName="size-3.5"
                  />
                ) : undefined
              }
              onClick={() => toggleProject(project.path)}
            />
          ))}
        </>
      ) : null}

      {hasActiveInboxFilters(filters) ? (
        <>
          <div role="separator" className="aven-menu-separator" />
          <button
            type="button"
            role="menuitem"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(DEFAULT_INBOX_FILTERS)}
            className="aven-menu-item"
          >
            <span className="aven-menu-label">Clear filters</span>
          </button>
        </>
      ) : null}
    </Popover>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div role="presentation" className="aven-menu-section">
      {children}
    </div>
  );
}

function FilterItem({
  label,
  checked,
  icon,
  onClick,
}: {
  label: string;
  checked: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="aven-menu-item"
    >
      {icon ? (
        <span aria-hidden="true" className="aven-menu-icon">
          {icon}
        </span>
      ) : null}
      <span className="aven-menu-label">{label}</span>
      {checked ? (
        <Check aria-hidden="true" className="aven-menu-check" />
      ) : null}
    </button>
  );
}
