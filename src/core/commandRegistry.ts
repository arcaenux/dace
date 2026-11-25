import type { WorkspaceIntentRequest } from "./appIntents.ts";
import type { CommandItem, WorkspaceActivityId } from "./types.ts";

export interface CommandContext {
  activeActivity: WorkspaceActivityId;
  setActiveActivity: (activity: WorkspaceActivityId) => void;
  requestIntent: (request: WorkspaceIntentRequest) => void;
  onToggleNav?: () => void;
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
        ctx.requestIntent({ type: "new-record" });
        ctx.closeOverlay();
      },
    },
    {
      id: "attachments:import-document",
      name: "Import Research Document",
      description: "Import and preserve an external file in content-addressed managed storage",
      category: "Workspace",
      shortcut: "Ctrl+O",
      available: true,
      execute: () => {
        ctx.requestIntent({ type: "import-attachment" });
        ctx.closeOverlay();
      },
    },
    {
      id: "workspace:export-backup",
      name: "Export Backup",
      description: "Create a complete .ndarchive backup of your database and managed attachments",
      category: "Workspace",
      available: true,
      execute: () => {
        ctx.closeOverlay();
        ctx.requestIntent({ type: "export-backup" });
      },
    },
    {
      id: "workspace:restore-backup",
      name: "Restore Backup",
      description: "Validate a .ndarchive and safely replace this library after a recovery snapshot",
      category: "Workspace",
      available: true,
      execute: () => {
        ctx.closeOverlay();
        ctx.requestIntent({ type: "restore-backup" });
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
        ctx.requestIntent({ type: "search-records" });
        ctx.closeOverlay();
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
        if (ctx.activeActivity === "knowledge-desk" || ctx.activeActivity === "reader") {
          ctx.requestIntent({ type: "save-active" });
        } else {
          ctx.setNotice("Switch to Knowledge Desk or the Research Reader to save active documents.");
        }
        ctx.closeOverlay();
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
      id: "nav:toggle-rail",
      name: "Toggle Curved Sidebar",
      description: "Open or hide the curved navigation rail over the active view",
      category: "Navigation",
      shortcut: "Ctrl+B",
      available: Boolean(ctx.onToggleNav),
      execute: () => {
        ctx.onToggleNav?.();
        ctx.closeOverlay();
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
      id: "nav:knowledge-graph",
      name: "Open Knowledge Graph",
      description: "Explore the interactive knowledge graph and conceptual relationships",
      category: "Navigation",
      shortcut: "Alt+3",
      available: true,
      execute: () => {
        ctx.setActiveActivity("knowledge-graph");
        ctx.closeOverlay();
      },
    },
    {
      id: "nav:reader",
      name: "Open Research Reader",
      description: "Read research papers, highlight passages, and connect annotations to knowledge",
      category: "Navigation",
      shortcut: "Alt+4",
      available: true,
      execute: () => {
        ctx.setActiveActivity("reader");
        ctx.closeOverlay();
      },
    },
    {
      id: "reader:layout-reading",
      name: "Reader: Reading Layout",
      description: "Maximise the document surface for uninterrupted reading",
      category: "Workspace",
      shortcut: "Alt+Shift+1",
      available: true,
      execute: () => {
        ctx.requestIntent({ type: "reader-mode", mode: "reading" });
        ctx.closeOverlay();
      },
    },
    {
      id: "reader:layout-research",
      name: "Reader: Research Layout",
      description: "Show the document and writing workspace side by side",
      category: "Workspace",
      shortcut: "Alt+Shift+2",
      available: true,
      execute: () => {
        ctx.requestIntent({ type: "reader-mode", mode: "research" });
        ctx.closeOverlay();
      },
    },
    {
      id: "reader:layout-writing",
      name: "Reader: Writing Layout",
      description: "Expand the research notes while keeping source references",
      category: "Workspace",
      shortcut: "Alt+Shift+3",
      available: true,
      execute: () => {
        ctx.requestIntent({ type: "reader-mode", mode: "writing" });
        ctx.closeOverlay();
      },
    },
    {
      id: "nav:terminal",
      name: "Open Terminal",
      description: "Open a real local shell in an integrated PTY workspace",
      category: "Navigation",
      shortcut: "Alt+6",
      available: true,
      execute: () => {
        ctx.setActiveActivity("terminal");
        ctx.closeOverlay();
      },
    },
    {
      id: "system:settings",
      name: "Open Settings",
      description: "Configure startup, workspace, editor, storage and backup preferences",
      category: "System",
      shortcut: "Alt+5",
      available: true,
      execute: () => {
        ctx.setActiveActivity("settings");
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
