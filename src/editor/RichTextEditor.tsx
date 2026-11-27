import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  Check,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { ExcerptMarker } from "./excerptMarker.ts";

/**
 * Write like a document, store as Markdown.
 *
 * People type plain text and format it by selecting it (a small toolbar
 * appears over the selection) or with the usual shortcuts. Typing Markdown
 * still works for those who know it: "# " becomes a heading, "**bold**"
 * turns bold once closed, "- " starts a list. The saved value is Markdown,
 * so outlines, search, previews, backups and reader excerpts keep working.
 */

export type RichAction =
  | "h1"
  | "h2"
  | "h3"
  | "paragraph"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "highlight"
  | "code"
  | "link"
  | "bullet"
  | "numbered"
  | "task"
  | "quote"
  | "divider"
  | "clear";

export interface RichTextEditorHandle {
  focus: () => void;
  run: (action: RichAction) => void;
  /** Scroll to and select the nth heading (0-based) in document order. */
  jumpToHeading: (index: number) => void;
  getEditor: () => Editor | null;
}

interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  spellCheck?: boolean;
  ariaLabel?: string;
}

const BUBBLE_GROUPS: { action: RichAction; label: string; icon: LucideIcon }[][] = [
  [
    { action: "bold", label: "Bold (Ctrl+B)", icon: Bold },
    { action: "italic", label: "Italic (Ctrl+I)", icon: Italic },
    { action: "underline", label: "Underline (Ctrl+U)", icon: UnderlineIcon },
    { action: "strike", label: "Strikethrough", icon: Strikethrough },
    { action: "highlight", label: "Highlight", icon: Highlighter },
    { action: "code", label: "Inline code", icon: Code },
    { action: "link", label: "Link", icon: LinkIcon },
  ],
  [
    { action: "paragraph", label: "Normal text", icon: Pilcrow },
    { action: "h1", label: "Heading 1", icon: Heading1 },
    { action: "h2", label: "Heading 2", icon: Heading2 },
    { action: "h3", label: "Heading 3", icon: Heading3 },
  ],
  [
    { action: "bullet", label: "Bulleted list", icon: List },
    { action: "numbered", label: "Numbered list", icon: ListOrdered },
    { action: "task", label: "Checklist", icon: ListChecks },
    { action: "quote", label: "Quote", icon: Quote },
  ],
  [{ action: "clear", label: "Clear formatting", icon: Eraser }],
];

function isActive(editor: Editor, action: RichAction): boolean {
  switch (action) {
    case "h1":
      return editor.isActive("heading", { level: 1 });
    case "h2":
      return editor.isActive("heading", { level: 2 });
    case "h3":
      return editor.isActive("heading", { level: 3 });
    case "paragraph":
      return editor.isActive("paragraph");
    case "numbered":
      return editor.isActive("orderedList");
    case "bullet":
      return editor.isActive("bulletList");
    case "task":
      return editor.isActive("taskList");
    case "quote":
      return editor.isActive("blockquote");
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "highlight":
    case "code":
    case "link":
      return editor.isActive(action);
    default:
      return false;
  }
}

function runAction(editor: Editor, action: RichAction) {
  const chain = editor.chain().focus();
  switch (action) {
    case "h1":
      chain.toggleHeading({ level: 1 }).run();
      break;
    case "h2":
      chain.toggleHeading({ level: 2 }).run();
      break;
    case "h3":
      chain.toggleHeading({ level: 3 }).run();
      break;
    case "paragraph":
      chain.setParagraph().run();
      break;
    case "bold":
      chain.toggleBold().run();
      break;
    case "italic":
      chain.toggleItalic().run();
      break;
    case "underline":
      chain.toggleUnderline().run();
      break;
    case "strike":
      chain.toggleStrike().run();
      break;
    case "highlight":
      chain.toggleHighlight().run();
      break;
    case "code":
      chain.toggleCode().run();
      break;
    case "bullet":
      chain.toggleBulletList().run();
      break;
    case "numbered":
      chain.toggleOrderedList().run();
      break;
    case "task":
      chain.toggleTaskList().run();
      break;
    case "quote":
      chain.toggleBlockquote().run();
      break;
    case "divider":
      chain.setHorizontalRule().run();
      break;
    case "clear":
      chain.unsetAllMarks().clearNodes().run();
      break;
    case "link":
      // Handled by the link field in the selection toolbar.
      break;
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return `https://${trimmed}`;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { value, onChange, placeholder = "Start writing…", className = "", spellCheck = true, ariaLabel = "Note content" },
  ref
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The Markdown this editor last produced; an incoming value equal to it is
  // an echo of our own edit and must not reset the document or the caret.
  const lastEmittedRef = useRef<string>(value);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [, forceRender] = useState(0);
  // The page scrolls inside its own pane, so the toolbar follows that pane.
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      ExcerptMarker,
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: `rte-content ${className}`.trim(),
        spellcheck: spellCheck ? "true" : "false",
        "aria-label": ariaLabel,
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      lastEmittedRef.current = markdown;
      onChangeRef.current(markdown);
    },
    onSelectionUpdate: () => forceRender((n) => n + 1),
    onTransaction: () => forceRender((n) => n + 1),
  });

  // Content replaced from outside (record switch, excerpt appended, restore).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.setAttribute("spellcheck", spellCheck ? "true" : "false");
  }, [editor, spellCheck]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setScrollParent(editor.view.dom.closest<HTMLElement>(".kd-scroll, .reader-drawer-content"));
  }, [editor]);

  useEffect(() => {
    if (linkDraft !== null) requestAnimationFrame(() => linkInputRef.current?.focus());
  }, [linkDraft]);

  const openLink = () => {
    if (!editor) return;
    if (editor.state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: insert a placeholder word to turn into the link.
      const { from } = editor.state.selection;
      editor.chain().focus().insertContent("link").setTextSelection({ from, to: from + 4 }).run();
    }
    setLinkDraft((editor.getAttributes("link").href as string | undefined) ?? "");
  };

  const applyLink = () => {
    if (!editor || linkDraft === null) return;
    const href = normalizeUrl(linkDraft);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    setLinkDraft(null);
  };

  const handleLinkKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setLinkDraft(null);
      editor?.commands.focus();
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      run: (action) => {
        if (!editor) return;
        if (action === "link") openLink();
        else runAction(editor, action);
      },
      jumpToHeading: (index) => {
        if (!editor) return;
        let seen = -1;
        let target: { from: number; to: number } | null = null;
        editor.state.doc.descendants((node, pos) => {
          if (target) return false;
          if (node.type.name === "heading") {
            seen += 1;
            if (seen === index) target = { from: pos + 1, to: pos + node.nodeSize - 1 };
          }
          return true;
        });
        if (!target) return;
        editor.chain().focus().setTextSelection(target).scrollIntoView().run();
        const dom = editor.view.domAtPos((target as { from: number }).from).node as HTMLElement | Text;
        const element = dom instanceof HTMLElement ? dom : dom.parentElement;
        element?.closest("h1, h2, h3, h4")?.scrollIntoView({ block: "center" });
      },
      getEditor: () => editor,
    }),
    [editor]
  );

  if (!editor) return null;

  return (
    <div className="rte">
      <BubbleMenu
        editor={editor}
        className="rte-bubble"
        // Drawn above every pane (fixed, at the app root) so a narrow page or a
        // side panel can never clip it; it flips/shifts to stay on screen.
        appendTo={() => document.querySelector<HTMLElement>(".dace-app") ?? document.body}
        options={{
          strategy: "fixed",
          placement: "top",
          offset: 8,
          flip: true,
          shift: { padding: 8 },
          hide: true,
          scrollTarget: scrollParent ?? window,
        }}
        shouldShow={({ editor: current, state }) => {
          if (linkDraft !== null) return true;
          const { empty } = state.selection;
          return !empty && current.isEditable && !current.isActive("excerptMarker");
        }}
      >
        {linkDraft !== null ? (
          <div className="rte-link-row" role="group" aria-label="Edit link">
            <LinkIcon size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              ref={linkInputRef}
              className="rte-link-input"
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={handleLinkKey}
              placeholder="Paste or type a link"
              aria-label="Link address"
            />
            <button type="button" className="rte-btn" onMouseDown={(e) => e.preventDefault()} onClick={applyLink} title="Apply link" aria-label="Apply link">
              <Check size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="rte-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setLinkDraft(null);
                editor.commands.focus();
              }}
              title="Cancel"
              aria-label="Cancel link"
            >
              <X size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="rte-bubble-row" role="toolbar" aria-label="Format selection">
            {BUBBLE_GROUPS.map((group, groupIndex) => (
              <div className="rte-bubble-group" key={groupIndex}>
                {group.map(({ action, label, icon: Icon }) => (
                  <button
                    key={action}
                    type="button"
                    className={`rte-btn ${isActive(editor, action) ? "is-active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => (action === "link" ? openLink() : runAction(editor, action))}
                    title={label}
                    aria-label={label}
                    aria-pressed={isActive(editor, action)}
                  >
                    <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
});
