import type { CrewMemberView, CrewStatus } from "../lib/crewView";

/** A crew as the app hands it to the sidebar: plain data, so the floating sidebar can show it too. */
export type SidebarCrew = {
  path: string;
  /** Its project's name. */
  project: string;
  status: CrewStatus;
  /** "7 of 20 runs today". */
  runsLine: string;
  paused: boolean;
  members: CrewMemberView[];
};
