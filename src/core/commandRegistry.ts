import type { WorkspaceIntentRequest } from "./appIntents.ts";
import type { CommandItem, WorkspaceActivityId } from "./types.ts";

export interface CommandContext {
  activeActivity: WorkspaceActivityId;
  setActiveActivity: (activity: WorkspaceActivityId) => void;
  requestIntent: (request: WorkspaceIntentRequest) => void;
  onToggleNav?: () => void;
  colorMode?: "light" | "dark";
  onToggleColorMode?: () => void;
  onToggleAssistant?: () => void;
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
      name: "Open Home",
      description: "Go to Home: the clock, recent work and workspaces",
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
      description: "Write, organise and search your notes",
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
      name: "New Record",
      description: "Create a new note in the Knowledge Desk",
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
      name: "Import Document",
      description: "Import a PDF, Markdown or text file into your library",
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
      description: "Create a complete .dacebackup of your notes, database and documents",
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
      description: "Validate a .dacebackup and safely replace this library after a recovery snapshot",
      category: "Workspace",
      available: true,
      execute: () => {
        ctx.closeOverlay();
        ctx.requestIntent({ type: "restore-backup" });
      },
    },
    {
      id: "knowledge:search-records",
      name: "Search Records",
      description: "Search your notes by title or content",
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
      name: "Save Now",
      description: "Save the open record or reader note immediately",
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
        ? "Return to the normal window"
        : "Full-screen, distraction-free reading and writing",
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
      name: "Show or Hide Navigation",
      description: "Show or hide the navigation rail",
      category: "Navigation",
      shortcut: "Ctrl+B",
      available: Boolean(ctx.onToggleNav),
      execute: () => {
        ctx.onToggleNav?.();
        ctx.closeOverlay();
      },
    },
    {
      id: "appearance:toggle-theme",
      name: ctx.colorMode === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      description: "Switch between the light and dark appearance",
      category: "Appearance",
      shortcut: "Ctrl+Shift+L",
      available: Boolean(ctx.onToggleColorMode),
      execute: () => {
        ctx.onToggleColorMode?.();
        ctx.closeOverlay();
      },
    },
    {
      id: "assistant:toggle",
      name: "Show or Hide Side Browser",
      description: "ChatGPT, Gemini or another site beside your work",
      category: "Workspace",
      shortcut: "Ctrl+Shift+A",
      available: Boolean(ctx.onToggleAssistant),
      execute: () => {
        ctx.closeOverlay();
        ctx.onToggleAssistant?.();
      },
    },
    {
      id: "help:shortcuts",
      name: "Keyboard Shortcuts",
      description: "Show every keyboard shortcut",
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
      description: "See how your records connect",
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
      description: "Read documents, highlight passages and write notes beside them",
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
      description: "Show only the document",
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
      description: "Show the document and your note side by side",
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
      description: "Show your note full width, with a link back to the document",
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
      description: "Open a shell inside Dace",
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
      description: "Startup, appearance, editor, storage, backup and update preferences",
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
