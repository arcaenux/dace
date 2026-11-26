import { RefObject, useEffect, useRef } from "react";

type DismissableRef = RefObject<HTMLElement | null> | null | undefined;

interface DismissableOptions {
  /** Element that opens the surface. Clicks on it are left to its own toggle. */
  triggerRef?: DismissableRef;
  /** Additional elements that must never count as an outside click. */
  ignoredRefs?: DismissableRef[];
  /** Surfaces in the same group dismiss one another when opened. */
  group?: string;
  /** Move focus into the surface when it opens. */
  autoFocus?: boolean;
  /** Return focus to the previously focused element when the surface closes. */
  restoreFocus?: boolean;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  /** Avoid dismissing a popover from the click that created it (e.g. text selection). */
  outsideClickGraceMs?: number;
  /** Block global workspace shortcuts while this surface is open. */
  blocksShortcuts?: boolean;
}

interface SurfaceRegistration {
  dismiss: () => void;
  blocksShortcuts: boolean;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const activeSurfaces = new Map<string, Set<SurfaceRegistration>>();
const blockingSurfaces = new Set<SurfaceRegistration>();

/** True while a modal surface has opted out of global workspace shortcuts. */
export function areShortcutsBlocked(): boolean {
  return blockingSurfaces.size > 0;
}

function isWithin(
  target: Node,
  path: EventTarget[],
  candidate: HTMLElement | null | undefined
): boolean {
  if (!candidate) return false;
  return target === candidate || candidate.contains(target) || path.includes(candidate);
}

function hasIgnoredAncestor(target: Node, path: EventTarget[]): boolean {
  const fromPath = path.some(
    (entry) => entry instanceof Element && entry.closest("[data-dismiss-ignore]") !== null
  );
  if (fromPath) return true;
  return target instanceof Element && target.closest("[data-dismiss-ignore]") !== null;
}

/**
 * Shared dismissal behavior for menus, popovers, dropdowns, panels and dialogs.
 *
 * Escape and outside clicks dismiss the surface. Trigger elements and
 * explicitly ignored elements are excluded so the same trigger can toggle the
 * surface closed instead of closing and immediately reopening it. Surfaces in
 * a group are mutually exclusive, and focus is restored on cleanup.
 */
export function useDismissable(
  isOpen: boolean,
  onDismiss: () => void,
  surfaceRef: DismissableRef,
  options: DismissableOptions = {}
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const {
    triggerRef,
    ignoredRefs,
    group,
    autoFocus = false,
    restoreFocus = true,
    closeOnOutsideClick = true,
    closeOnEscape = true,
    outsideClickGraceMs = 0,
    blocksShortcuts = false,
  } = options;

  const ignoredRefsRef = useRef(ignoredRefs);
  ignoredRefsRef.current = ignoredRefs;

  useEffect(() => {
    if (!isOpen) return;

    const registration: SurfaceRegistration = {
      dismiss: () => dismissRef.current(),
      blocksShortcuts,
    };
    if (blocksShortcuts) blockingSurfaces.add(registration);

    let siblings: Set<SurfaceRegistration> | null = null;
    if (group) {
      siblings = activeSurfaces.get(group) ?? new Set<SurfaceRegistration>();
      activeSurfaces.set(group, siblings);
      for (const sibling of Array.from(siblings)) {
        if (sibling !== registration) sibling.dismiss();
      }
      siblings.add(registration);
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openedAt = performance.now();
    let focusFrame: number | null = null;

    if (autoFocus) {
      focusFrame = requestAnimationFrame(() => {
        const surface = surfaceRef?.current;
        if (!surface) return;
        const initial = surface.querySelector<HTMLElement>("[data-overlay-initial-focus]");
        const target =
          initial ??
          surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
          (surface.tabIndex >= 0 ? surface : null);
        target?.focus({ preventScroll: true });
      });
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
    };

    const handleClick = (event: MouseEvent) => {
      if (!closeOnOutsideClick || event.defaultPrevented || event.button !== 0) return;
      if (outsideClickGraceMs > 0 && performance.now() - openedAt < outsideClickGraceMs) return;

      const target = event.target;
      if (!(target instanceof Node)) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];

      if (isWithin(target, path, surfaceRef?.current)) return;
      if (isWithin(target, path, triggerRef?.current)) return;
      for (const ignored of ignoredRefsRef.current ?? []) {
        if (isWithin(target, path, ignored?.current)) return;
      }
      if (hasIgnoredAncestor(target, path)) return;

      dismissRef.current();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClick);
      if (blocksShortcuts) blockingSurfaces.delete(registration);
      if (focusFrame !== null) cancelAnimationFrame(focusFrame);

      if (siblings) {
        siblings.delete(registration);
        if (siblings.size === 0) activeSurfaces.delete(group as string);
      }

      if (restoreFocus && previouslyFocused?.isConnected) {
        const active = document.activeElement;
        const focusWasMovedIntoSurface =
          active instanceof Node && isWithin(active, [], surfaceRef?.current);
        if (!active || active === document.body || focusWasMovedIntoSurface) {
          previouslyFocused.focus({ preventScroll: true });
        }
      }
    };
    // Ref objects and scalar options are stable; ignoredRefs is read from a ref.
  }, [
    isOpen,
    surfaceRef,
    triggerRef,
    group,
    autoFocus,
    restoreFocus,
    closeOnOutsideClick,
    closeOnEscape,
    outsideClickGraceMs,
    blocksShortcuts,
  ]);
}
