import { Node } from "@tiptap/core";

/**
 * Reader notes link each quoted passage back to its source with a hidden
 * HTML comment (`<!-- dace-excerpt:… -->`) on the line above the quote.
 * A rich-text editor would normally drop comments on save, silently breaking
 * those links, so this invisible block node carries the marker through
 * editing byte-for-byte.
 */
const MARKER_LINE = /^<!-- dace-excerpt:[^\n]*? -->[^\S\n]*(?:\n|$)/;

export const ExcerptMarker = Node.create({
  name: "excerptMarker",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      raw: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-raw") ?? "",
        renderHTML: (attributes) => ({ "data-raw": attributes.raw }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-excerpt-marker]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      {
        ...HTMLAttributes,
        "data-excerpt-marker": "",
        class: "rte-excerpt-marker",
        "aria-hidden": "true",
        contenteditable: "false",
      },
    ];
  },

  markdownTokenizer: {
    name: "excerptMarker",
    level: "block",
    start: (src: string) => src.indexOf("<!-- dace-excerpt:"),
    tokenize: (src: string) => {
      const match = MARKER_LINE.exec(src);
      if (!match) return undefined;
      return { type: "excerptMarker", raw: match[0], text: match[0].trim() };
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode("excerptMarker", { raw: String(token.text ?? token.raw ?? "").trim() }),

  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});
