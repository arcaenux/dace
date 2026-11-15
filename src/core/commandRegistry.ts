import { CommandItem, WorkspaceActivityId } from "./types";

export interface CommandContext {
  activeActivity: WorkspaceActivityId;
  setActiveActivity: (activity: WorkspaceActivityId) => void;
  isFocusSpace: boolean;
  enterFocusSpace: () => Promise<void>;
  exitFocusSpace: () => Promise<void>;
  toggleFocusSpace: () => Promise<void>;
  openOverlay: (overlay: "command-palette" | "shortcut-reference" | "contextual-panel") => void;
  closeOverlay: () => void;
  setNotice: (message: string) => void;
}

/**
 * Builds the registered command catalog based on current application context.
 */
export function buildCommandList(ctx: CommandContext): CommandItem[] {
  const commands: CommandItem[] = [
    {
      id: "nav:workspace",
      name: "Open Workspace",
      description: "Return to the central intellectual workspace",
      category: "Navigation",
      shortcut: "Alt+1",
      available: true,
      execute: () => {
        ctx.setActiveActivity("workspace");
        ctx.closeOverlay();
      },
    },
    {
      id: "nav:knowledge-desk",
      name: "Open Knowledge Desk",
      description: "Author, organize, and search personal knowledge records in SQLite",
      category: "Navigation",
      shortcut: "Alt+2",
      available: true,
      execute: () => {
        ctx.setActiveActivity("knowledge-desk");
        ctx.closeOverlay();
      },
    },
    {
      id: "knowledge:new-record",
      name: "Create Knowledge Record",
      description: "Initialize a new atomic record in SQLite",
      category: "Workspace",
      shortcut: "Ctrl+N",
      available: true,
      execute: () => {
        ctx.setActiveActivity("knowledge-desk");
        ctx.closeOverlay();
        window.dispatchEvent(new CustomEvent("novadome:new-record"));
      },
    },
    {
      id: "knowledge:search-records",
      name: "Search Knowledge Records",
      description: "Query knowledge records by title or content in SQLite",
      category: "Workspace",
      shortcut: "Ctrl+Shift+F",
      available: true,
      execute: () => {
        ctx.setActiveActivity("knowledge-desk");
        ctx.closeOverlay();
        window.dispatchEvent(new CustomEvent("novadome:search-records"));
      },
    },
    {
      id: "knowledge:save-record",
      name: "Save Current Record",
      description: "Explicitly flush and commit active record to SQLite",
      category: "Workspace",
      shortcut: "Ctrl+S",
      available: true,
      execute: () => {
        if (ctx.activeActivity === "knowledge-desk") {
          window.dispatchEvent(new CustomEvent("novadome:save-record"));
          ctx.closeOverlay();
        } else {
          ctx.setNotice("Switch to Knowledge Desk to save active documents.");
          ctx.closeOverlay();
        }
      },
    },
    {
      id: "focus:toggle",
      name: ctx.isFocusSpace ? "Exit Focus Space" : "Enter Focus Space",
      description: ctx.isFocusSpace
        ? "Restore standard windowed workspace chrome"
        : "Immerse in full-screen distraction-free environment",
      category: "Focus Space",
      shortcut: "F11",
      available: true,
      execute: async () => {
        ctx.closeOverlay();
        await ctx.toggleFocusSpace();
      },
    },
    {
      id: "help:shortcuts",
      name: "Show Shortcuts and Actions",
      description: "Display keyboard shortcut discovery reference",
      category: "System",
      shortcut: "Ctrl+Shift+P",
      available: true,
      execute: () => {
        ctx.openOverlay("shortcut-reference");
      },
    },
    {
      id: "nav:reader",
      name: "Open Reader",
      description: "Read PDFs, epubs, web articles and extract literature notes",
      category: "Navigation",
      available: false,
      unavailabilityReason: "Planned for Milestone 3 (Document Ingestion & Reading)",
      execute: () => {
        ctx.setNotice("Document Reader is planned for Milestone 3.");
        ctx.closeOverlay();
      },
    },
    {
      id: "nav:knowledge-graph",
      name: "Open Knowledge Graph",
      description: "Explore interactive astronomical knowledge graph and conceptual relationships",
      category: "Navigation",
      shortcut: "Alt+3",
      available: true,
      execute: () => {
        ctx.setActiveActivity("knowledge-graph");
        ctx.closeOverlay();
      },
    },
    {
      id: "nav:terminal",
      name: "Open Terminal",
      description: "Embedded pseudo-terminal for workspace CLI automation",
      category: "Navigation",
      available: false,
      unavailabilityReason: "Planned for Milestone 5 (PTY & Native Subsystems)",
      execute: () => {
        ctx.setNotice("Terminal integration is planned for Milestone 5.");
        ctx.closeOverlay();
      },
    },
    {
      id: "system:settings",
      name: "Open Settings",
      description: "Configure local storage, appearance, backups and capabilities",
      category: "System",
      available: false,
      unavailabilityReason: "Planned for Milestone 6 (System Settings & Administration)",
      execute: () => {
        ctx.setNotice("Settings panel is scheduled for Milestone 6.");
        ctx.closeOverlay();
      },
    },
  ];

  return commands;
}

/**
 * Filter helper: matches query against command name, category, and description.
 */
export function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return commands;

  return commands.filter((cmd) => {
    const inName = cmd.name.toLowerCase().includes(clean);
    const inDesc = cmd.description ? cmd.description.toLowerCase().includes(clean) : false;
    const inCategory = cmd.category.toLowerCase().includes(clean);
    return inName || inDesc || inCategory;
  });
}
