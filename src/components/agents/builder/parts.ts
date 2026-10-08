/**
 * The parts of an agent and the one icon each has, so the progress rail and the agent
 * card draw the same picture for the same thing. Pure data, no React, so it can be
 * tested in node.
 */
import {
  Brain,
  CalendarClock,
  Crosshair,
  Database,
  LogOut,
  Rocket,
  ScrollText,
  Shield,
  Tag,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { BuilderStepId, PreviewRowId, RequiredId } from "./contract";

/**
 * A part of the agent: the builder's eight steps, the Manage step a saved agent's settings
 * end on, and the two card rows that live inside a step.
 */
export type PartId = BuilderStepId | "manage" | "exits" | "funding";

/** The one icon each part has, everywhere it is drawn. Never import these eleven from lucide anywhere else in the builder. */
export const PART_ICON: Record<PartId, LucideIcon> = {
  name: Tag,
  strategy: ScrollText,
  hunts: Crosshair,
  data: Database,
  limits: Shield,
  exits: LogOut,
  schedule: CalendarClock,
  brain: Brain,
  create: Rocket,
  manage: Wrench,
  funding: Wallet,
};

/** The lucide export name of each, for the drift test. Keep in step with the import above. */
export const PART_ICON_NAME: Record<PartId, string> = {
  name: "Tag",
  strategy: "ScrollText",
  hunts: "Crosshair",
  data: "Database",
  limits: "Shield",
  exits: "LogOut",
  schedule: "CalendarClock",
  brain: "Brain",
  create: "Rocket",
  manage: "Wrench",
  funding: "Wallet",
};

/** The part each "Already set" row is. */
export const ROW_PART: Record<PreviewRowId, PartId> = {
  hunts: "hunts",
  data: "data",
  limits: "limits",
  exits: "exits",
  runs: "schedule",
  thinks: "brain",
  money: "funding",
};

/** The part each "Yours to decide" item is. */
export const REQUIRED_PART: Record<RequiredId, PartId> = {
  name: "name",
  strategy: "strategy",
  think: "brain",
};

/** The step a part is edited on. Only the two row-only parts differ from their own id. */
export const PART_STEP: Record<PartId, BuilderStepId | "manage"> = {
  name: "name",
  strategy: "strategy",
  hunts: "hunts",
  data: "data",
  limits: "limits",
  exits: "limits",
  schedule: "schedule",
  brain: "brain",
  create: "create",
  manage: "manage",
  funding: "create",
};

/** One stroke weight for a part icon at rest, so the rail and the card are the same drawing. */
export const PART_STROKE = 1.75;
