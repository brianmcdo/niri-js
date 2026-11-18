import { mountPane } from "./host.ts";
import {
  cameraFor,
  closePane as closeInLayout,
  createLayout,
  cursorBox,
  defaultColumnWidth,
  findCursor,
  focusBy,
  focusEdge,
  focusHome,
  focusPane as focusInLayout,
  insertAsSplit,
  measure,
  moveColumn,
  movePane,
  openPane as openInLayout,
  openPaneAt,
  paneIds,
  relocatePane,
  removeBlank,
  resizeColumn,
  resizeSplit,
  sceneBounds,
  splitBlank,
  splitPlane,
  toggleMaximized,
} from "./layout.ts";
import type { SeedColumn } from "./layout.ts";
import { assertLayout } from "./layout.ts";
import { matchShortcut, shortcutLabel, type ShortcutAction } from "./shortcuts.ts";
import { searchPalette, type PaletteHit } from "./spotlight.ts";
import { PaneBus } from "./bus.ts";
import { emptyTrail, forgetFocus, recordFocus, stepBack, stepForward, type FocusTrail } from "./history.ts";
import {
  exportDocument,
  parseLayoutFile,
  parseSession,
  pushClosed,
  serializableSnapshot,
  workspaceIdFor,
  type ClosedRecord,
  type WorkspaceSnapshot,
} from "./session.ts";
import {
  addPaneToGroup,
  assignPane,
  cycleMember,
  groupOf,
  normalizeGroups,
  orderedMembers,
  ungroupPane,
  withGroups,
  type PaneGroup,
} from "./groups.ts";
import type { Box, Cursor, Layout, PaneBusEvent, PaneContext, PaneDefinition, PaneHandle, PaneSource, Scene } from "./types.ts";

export interface TapeWorkspaceOptions {
  workspaceId?: string;
  panes?: PaneDefinition[];
  columns?: SeedColumn[];
  layout?: Layout;
  /** Set to null to keep the arrangement in memory only. */
  storageKey?: string | null;
  runway?: number;
  focusAnchor?: "center" | "start";
  /** Keep pane content running while the camera moves. */
  liveContent?: boolean;
  compactBreakpoint?: number;
  gap?: number;
  padding?: number;
  paneLink?: boolean;
  /** Groups restored by Reset, alongside the original panes. */
  groups?: PaneGroup[];
  onLayoutChange?: (layout: Layout) => void;
}

interface Shell {
  root: HTMLElement;
  body: HTMLElement;
  title: HTMLElement;
  group: HTMLButtonElement;
  bottom: HTMLElement;
}

interface Gesture {
  kind: "press" | "move" | "resize-x" | "resize-y" | "pan";
  id: number;
  startX: number;
  startY: number;
  cursor: Cursor;
  paneId: string | null;
  layout: Layout;
  width: number;
  weights: [number, number];
  pan: { x: number; y: number };
  moved: boolean;
}

const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export class TapeWorkspace {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly status: HTMLElement;
  private readonly minimap: HTMLElement;
  private readonly minimapWorld: HTMLElement;
  private readonly minimapView: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly groupBar: HTMLElement;
  private readonly groupMenu: HTMLElement;
  private readonly groupMenuList: HTMLElement;
  private readonly groupMenuTitle: HTMLElement;
  private readonly groupMenuRemove: HTMLButtonElement;
  private readonly groupMenuInput: HTMLInputElement;
  private readonly spotlight: HTMLDialogElement;
  private readonly spotlightInput: HTMLInputElement;
  private readonly spotlightList: HTMLUListElement;
  private readonly spotlightEmpty: HTMLParagraphElement;
  private spotlightIndex = 0;
  private spotlightHits: PaletteHit[] = [];
  private readonly workspaceButton: HTMLButtonElement;
  private readonly workspaceMenu: HTMLElement;
  private readonly workspaceMenuList: HTMLElement;
  private readonly workspaceNameInput: HTMLInputElement;
  private readonly importInput: HTMLInputElement;
  private readonly bus = new PaneBus();
  private readonly busStops = new Map<string, Set<() => void>>();
  private trail: FocusTrail = emptyTrail();
  private suppressHistory = false;
  private closed: ClosedRecord[] = [];
  private workspaces: WorkspaceSnapshot[] = [];
  private activeWorkspaceId: string;
  private readonly overviewButton: HTMLButtonElement;
  private readonly options: Required<
    Pick<
      TapeWorkspaceOptions,
      | "workspaceId"
      | "runway"
      | "focusAnchor"
      | "liveContent"
      | "compactBreakpoint"
      | "gap"
      | "padding"
      | "paneLink"
    >
  > &
    TapeWorkspaceOptions;

  private layout: Layout;
  private readonly panes = new Map<string, PaneDefinition>();
  private readonly shells = new Map<string, Shell>();
  private readonly handles = new Map<string, PaneHandle>();
  private readonly tokens = new Map<string, number>();
  private readonly ghosts: HTMLElement[] = [];
  private scene: Scene = { boxes: [], width: 0, height: 0 };
  private viewport = { width: 0, height: 0 };
  private camera = { x: 0, y: 0, scale: 1 };
  private target = { x: 0, y: 0, scale: 1 };
  private overview = false;
  private overviewZoom = 1;
  private overviewPan = { x: 0, y: 0 };
  private group = false;
  private activeGroupId: string | null = null;
  private groupMenuPaneId: string | null = null;
  private compact = false;
  private resizing = false;
  private snapNext = true;
  private motion = false;
  private gesture: Gesture | null = null;
  private dropKey = "";
  private minimapKey = "";
  private announced = "";
  private readonly contextKeys = new Map<string, string>();
  private syncQueued = false;
  private frameId = 0;
  private lastFrame = 0;
  private readonly reduced: boolean;
  private readonly initialPanes: PaneDefinition[];
  private readonly initialColumns: SeedColumn[];
  private readonly onResize: ResizeObserver;
  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
  private readonly onPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
  private readonly onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
  private readonly onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);

  constructor(container: HTMLElement, options: TapeWorkspaceOptions = {}) {
    this.options = {
      workspaceId: "tape",
      runway: 1,
      focusAnchor: "center",
      liveContent: false,
      compactBreakpoint: 640,
      gap: 18,
      padding: 28,
      paneLink: true,
      ...options,
    };
    this.initialPanes = options.panes ?? [];
    this.initialColumns = options.columns ?? this.initialPanes.map((pane) => ({ paneIds: [pane.paneId] }));
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.layout = createLayout(this.options.workspaceId, [], defaultColumnWidth(1200));
    this.activeWorkspaceId = this.options.workspaceId;

    this.root = document.createElement("div");
    this.root.className = "tape";
    this.root.dataset.tapeRoot = "";
    this.root.addEventListener("keydown", this.onKey);

    const bar = document.createElement("header");
    bar.className = "tape-bar";
    this.groupBar = document.createElement("div");
    this.groupBar.className = "tape-groups";
    this.workspaceButton = command("Main", "Workspaces", () => this.toggleWorkspaceMenu());
    this.workspaceButton.classList.add("tape-workspace-chip");
    bar.append(mark(), hint(apple), this.workspaceButton, this.groupBar);
    const actions = document.createElement("div");
    actions.className = "tape-bar-actions";
    actions.append(
      command("Search", label("spotlight", "Search panes and commands"), () => this.openSpotlight()),
      command("Group", label("editGroup", "Group the focused pane"), () => this.openGroupMenu()),
      command("Reset", "Restore the original panes", () => this.reset()),
      command("New pane", "Load a component into a pane", () => this.openDialog()),
    );
    bar.append(actions);

    this.stage = document.createElement("div");
    this.stage.className = "tape-stage";
    this.stage.tabIndex = 0;
    this.stage.setAttribute("role", "region");
    this.stage.setAttribute("aria-label", "niri-js workspace");
    this.world = document.createElement("div");
    this.world.className = "tape-world";
    this.ring = document.createElement("div");
    this.ring.className = "tape-ring";
    this.ring.setAttribute("aria-hidden", "true");
    this.world.append(this.ring);

    this.minimap = document.createElement("div");
    this.minimap.className = "tape-minimap";
    this.minimap.setAttribute("aria-hidden", "true");
    this.minimapWorld = document.createElement("div");
    this.minimapWorld.className = "tape-minimap-world";
    this.minimapView = document.createElement("div");
    this.minimapView.className = "tape-minimap-view";
    this.minimapWorld.append(this.minimapView);
    this.minimap.append(this.minimapWorld);

    const controls = document.createElement("div");
    controls.className = "tape-controls";
    this.overviewButton = command("Overview", label("overview", "Show every pane"), () => this.toggleOverview());
    controls.append(
      command("←", label("focusLeft", "Focus left"), () => this.apply(focusBy(this.layout, -1, 0, this.options.runway))),
      command("↑", label("focusUp", "Focus up"), () => this.apply(focusBy(this.layout, 0, -1, this.options.runway))),
      command("↓", label("focusDown", "Focus down"), () => this.apply(focusBy(this.layout, 0, 1, this.options.runway))),
      command("→", label("focusRight", "Focus right"), () => this.apply(focusBy(this.layout, 1, 0, this.options.runway))),
      this.overviewButton,
      command("Split", label("splitRight", "Blank column to the right"), () =>
        this.apply(splitBlank(this.layout, "right", this.columnWidth())),
      ),
      command("Maximize", label("maximize", "Fill the stage"), () => this.apply(toggleMaximized(this.layout))),
      command("Home", label("home", "Return home"), () => this.goHome()),
    );

    this.status = document.createElement("div");
    this.status.className = "tape-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");

    this.dialog = buildDialog(
      this.initialPanes,
      (pane) => {
        this.closeDialog();
        this.openPane(pane);
      },
      (source) => {
        this.closeDialog();
        this.openPane(source);
      },
      () => this.closeDialog(),
    );
    const spotlight = buildSpotlight();
    this.spotlight = spotlight.dialog;
    this.spotlightInput = spotlight.input;
    this.spotlightList = spotlight.list;
    this.spotlightEmpty = spotlight.empty;
    this.spotlightInput.addEventListener("input", () => {
      this.spotlightIndex = 0;
      this.renderSpotlight();
    });
    this.spotlight.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeSpotlight();
    });
    spotlight.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.chooseSpotlight();
    });
    const menu = buildGroupMenu(
      () => this.ungroupMenuPane(),
      (name) => this.createMenuGroup(name),
    );
    this.groupMenu = menu.root;
    this.groupMenuList = menu.list;
    this.groupMenuTitle = menu.title;
    this.groupMenuRemove = menu.remove;
    this.groupMenuInput = menu.input;
    const spaces = buildWorkspaceMenu(
      (name) => this.createWorkspace(name),
      (name) => this.renameWorkspace(name),
      () => this.exportLayout(),
      () => this.importInput.click(),
    );
    this.workspaceMenu = spaces.root;
    this.workspaceMenuList = spaces.list;
    this.workspaceNameInput = spaces.rename;
    this.importInput = document.createElement("input");
    this.importInput.type = "file";
    this.importInput.accept = "application/json,.json";
    this.importInput.hidden = true;
    this.importInput.addEventListener("change", () => {
      const file = this.importInput.files?.[0];
      this.importInput.value = "";
      if (file) void this.importLayout(file);
    });

    this.stage.append(this.world, this.minimap, controls);
    this.root.append(bar, this.groupMenu, this.workspaceMenu, this.stage, this.status, this.dialog, this.spotlight, this.importInput);
    container.replaceChildren(this.root);

    this.stage.addEventListener("pointerdown", this.onPointerDown);
    this.stage.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    this.onResize = new ResizeObserver(() => this.onStageResize());
    this.onResize.observe(this.stage);

    this.onStageResize();
    this.stage.focus({ preventScroll: true });
  }

  destroy(): void {
    this.onResize.disconnect();
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    for (const handle of this.handles.values()) handle.destroy();
    this.bus.clear();
    this.busStops.clear();
    this.root.remove();
  }

  openPane(pane: PaneDefinition): string {
    const paneId = uniqueId(pane.paneId, this.panes);
    this.panes.set(paneId, { ...pane, paneId });
    this.apply(openInLayout(this.layout, paneId, this.columnWidth()));
    return paneId;
  }

  closePane(paneId: string): void {
    const pane = this.panes.get(paneId);
    const cursor = findCursor(this.layout, paneId);
    if (!pane && !cursor) return;
    if (pane && cursor) {
      this.closed = pushClosed(this.closed, {
        pane: copyPane(pane),
        cursor,
        groupId: groupOf(this.layout.groups, paneId)?.id ?? null,
      });
    }
    this.apply(closeInLayout(this.layout, paneId));
    this.trail = forgetFocus(this.trail, paneId);
    this.releaseBus(paneId);
    this.panes.delete(paneId);
  }

  focusPane(paneId: string): void {
    const cursor = findCursor(this.layout, paneId);
    if (!cursor) return;
    if (this.overview) this.overview = false;
    this.apply(focusInLayout(this.layout, paneId));
  }

  toggleOverview(force?: boolean): void {
    const next = force ?? !this.overview;
    if (next === this.overview && !this.layout.maximizedPaneId) return;
    this.overview = next;
    if (next) {
      this.overviewZoom = 1;
      this.overviewPan = { x: 0, y: 0 };
    }
    if (this.layout.maximizedPaneId) {
      this.apply(toggleMaximized(this.layout));
      return;
    }
    this.root.classList.toggle("is-overview", this.overview);
    this.overviewButton.setAttribute("aria-pressed", String(this.overview));
    this.retarget();
    this.kick();
    this.syncRuntime();
    this.announce();
  }

  getLayout(): Layout {
    return structuredClone(this.layout);
  }

  private reset(): void {
    this.overview = false;
    this.group = false;
    this.activeGroupId = null;
    this.closeGroupMenu();
    this.closeWorkspaceMenu();
    this.closed = [];
    this.useInitial();
    this.snapNext = true;
    this.clearShells();
    this.render();
    this.persist();
    this.announce();
    this.writePaneLink();
  }

  private goHome(): void {
    this.overview = false;
    this.apply(focusHome(this.layout));
  }

  private onStageResize(): void {
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (width === 0 || height === 0) return;
    const first = this.viewport.width === 0;
    this.viewport = { width, height };
    const compact = width < this.options.compactBreakpoint;
    if (compact !== this.compact) {
      this.compact = compact;
      if (compact) this.overview = false;
    }
    if (first) this.restore();
    this.render();
    if (first) {
      this.announce();
      this.writePaneLink();
    }
  }

  private restore(): void {
    const saved = this.readStorage();
    if (saved) {
      this.workspaces = saved.workspaces;
      this.closed = saved.closed;
      const active = saved.workspaces.find((item) => item.id === saved.activeId) ?? saved.workspaces[0];
      if (active) this.loadSnapshot(active);
    } else if (this.options.layout) {
      assertLayout(this.options.layout);
      this.layout = structuredClone(this.options.layout);
      for (const pane of this.initialPanes) this.panes.set(pane.paneId, pane);
      this.rememberActive();
    } else {
      this.useInitial();
    }
    const requested = new URL(location.href).searchParams.get("pane");
    if (requested && findCursor(this.layout, requested)) {
      this.layout = focusInLayout(this.layout, requested);
    }
    this.snapNext = true;
  }

  private useInitial(): void {
    this.panes.clear();
    for (const pane of this.initialPanes) this.panes.set(pane.paneId, copyPane(pane));
    this.layout = createLayout(
      this.activeWorkspaceId,
      this.initialColumns,
      defaultColumnWidth(this.viewport.width || window.innerWidth),
    );
    if (this.options.groups?.length) {
      this.layout.groups = normalizeGroups(this.options.groups, new Set(paneIds(this.layout)));
    }
    this.trail = emptyTrail();
    this.rememberActive();
  }

  private readStorage(): ReturnType<typeof parseSession> {
    if (!this.options.storageKey) return null;
    const raw = localStorage.getItem(this.options.storageKey);
    if (!raw) return null;
    const saved = parseSession(raw);
    if (!saved) {
      localStorage.removeItem(this.options.storageKey);
      return null;
    }
    return saved;
  }

  private apply(next: Layout): void {
    if (next === this.layout) return;
    const from = paneAt(this.layout);
    const to = paneAt(next);
    if (!this.suppressHistory) this.trail = recordFocus(this.trail, from, to);
    const previous = `${this.layout.cursor.plane}:${this.layout.cursor.column}`;
    this.layout = next;
    if (`${next.cursor.plane}:${next.cursor.column}` !== previous) this.group = false;
    this.render();
    this.persist();
    this.options.onLayoutChange?.(next);
    this.announce();
    this.writePaneLink();
  }

  private render(): void {
    this.scene = measure(this.layout, this.viewport, {
      gap: this.options.gap,
      padding: this.options.padding,
      emptyWidth: defaultColumnWidth(this.viewport.width || 800),
    });
    const alive = new Set(paneIds(this.layout));
    for (const [id, shell] of this.shells) {
      if (alive.has(id)) continue;
      this.tokens.set(id, (this.tokens.get(id) ?? 0) + 1);
      this.handles.get(id)?.destroy();
      this.handles.delete(id);
      this.releaseBus(id);
      shell.root.remove();
      this.shells.delete(id);
    }

    const maximized = Boolean(this.layout.maximizedPaneId);
    const focusedId = paneAt(this.layout);
    let ghost = 0;
    for (const box of this.scene.boxes) {
      if (box.paneId) {
        const shell = this.ensureShell(box.paneId);
        place(shell.root, box, focusedId === box.paneId && (this.compact || maximized), this.viewport, this.compact);
        shell.root.hidden = (this.compact || maximized) && focusedId !== box.paneId;
        shell.root.classList.toggle("is-focused", focusedId === box.paneId);
        shell.root.classList.toggle(
          "is-group",
          this.group && box.plane === this.layout.cursor.plane && box.column === this.layout.cursor.column,
        );
        shell.root.classList.toggle("is-drop", this.dropKey === boxKey(box));
        const membership = groupOf(this.layout.groups, box.paneId);
        const showing = this.activeGroupId !== null && membership?.id === this.activeGroupId;
        shell.root.classList.toggle("in-group", showing);
        if (membership) shell.root.style.setProperty("--pane-group", membership.color);
        else shell.root.style.removeProperty("--pane-group");
        shell.group.hidden = !membership && focusedId !== box.paneId;
        shell.group.textContent = membership?.name ?? "Group";
        shell.group.title = membership ? `Group: ${membership.name}` : "Add to a group";
        shell.bottom.hidden = !this.hasSplitBelow(box) || this.compact || maximized || this.overview;
        const pane = this.panes.get(box.paneId);
        if (pane) shell.title.textContent = pane.title;
      } else {
        const node = this.ghosts[ghost] ?? this.createGhost();
        this.ghosts[ghost] = node;
        if (!node.isConnected) this.world.append(node);
        place(node, box, false, this.viewport, false);
        node.hidden = this.compact || maximized;
        const cursor = sameCursor(box, this.layout.cursor);
        node.classList.toggle("is-cursor", cursor);
        const add = node.querySelector("button");
        if (add instanceof HTMLButtonElement) add.hidden = !cursor;
        ghost += 1;
      }
    }
    for (const extra of this.ghosts.slice(ghost)) extra.remove();
    this.ghosts.length = ghost;

    const ringBox = cursorBox(this.scene, this.layout.cursor);
    if (ringBox && !this.compact && !maximized) {
      this.ring.hidden = false;
      this.ring.style.left = `${ringBox.x - 7}px`;
      this.ring.style.top = `${ringBox.y - 7}px`;
      this.ring.style.width = `${ringBox.width + 14}px`;
      this.ring.style.height = `${ringBox.height + 14}px`;
    } else {
      this.ring.hidden = true;
    }

    this.root.classList.toggle("is-overview", this.overview);
    this.root.classList.toggle("is-compact", this.compact);
    this.root.classList.toggle("is-maximized", maximized);
    if (this.activeGroupId && !this.layout.groups.some((group) => group.id === this.activeGroupId)) {
      this.activeGroupId = null;
    }
    this.root.classList.toggle("is-grouped", this.activeGroupId !== null);
    this.paintGroupBar();
    if (!this.groupMenu.hidden) this.paintGroupMenu();
    this.paintWorkspaceButton();
    if (!this.workspaceMenu.hidden) this.paintWorkspaceMenu();
    this.overviewButton.setAttribute("aria-pressed", String(this.overview));
    this.retarget();
    this.kick();
    this.queueSync();
    this.paintMinimap();
  }

  private ensureShell(paneId: string): Shell {
    const existing = this.shells.get(paneId);
    if (existing) return existing;
    const pane = this.panes.get(paneId) ?? missingPane(paneId);
    const root = document.createElement("article");
    root.className = "tape-pane";
    root.dataset.paneId = paneId;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", pane.title);

    const bar = document.createElement("header");
    bar.className = "tape-pane-bar";
    const kind = document.createElement("span");
    kind.className = "tape-pane-kind";
    kind.textContent = pane.surfaceKind;
    const title = document.createElement("h2");
    title.className = "tape-pane-title";
    title.textContent = pane.title;
    const group = document.createElement("button");
    group.type = "button";
    group.className = "tape-pane-group";
    group.textContent = "Group";
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openGroupMenu(paneId);
    });
    const actions = document.createElement("div");
    actions.className = "tape-pane-actions";
    actions.append(
      iconButton("Maximize", "M5 5h6v2H7v4H5V5zm8 12h4v-4h2v6h-6v-2z", () => this.apply(toggleMaximized(focusInLayout(this.layout, paneId)))),
      iconButton("Close", "M7 7l10 10M17 7L7 17", () => this.closePane(paneId)),
    );
    bar.append(kind, title, group, actions);
    bar.addEventListener("dblclick", () => this.apply(toggleMaximized(focusInLayout(this.layout, paneId))));

    const body = document.createElement("div");
    body.className = "tape-pane-body";
    const right = document.createElement("div");
    right.className = "tape-resize";
    right.dataset.edge = "right";
    const bottom = document.createElement("div");
    bottom.className = "tape-resize";
    bottom.dataset.edge = "bottom";
    root.append(bar, body, right, bottom);
    this.world.append(root);
    const shell = { root, body, title, group, bottom };
    this.shells.set(paneId, shell);
    void this.mount(pane, body);
    return shell;
  }

  private createGhost(): HTMLElement {
    const ghost = document.createElement("div");
    ghost.className = "tape-ghost";
    const label = document.createElement("p");
    label.textContent = "Empty";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add pane";
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      const cursor = readCursor(ghost);
      this.apply(focusByCursor(this.layout, cursor));
      this.openDialog();
    });
    ghost.append(label, add);
    return ghost;
  }

  private async mount(pane: PaneDefinition, body: HTMLElement): Promise<void> {
    const token = (this.tokens.get(pane.paneId) ?? 0) + 1;
    this.tokens.set(pane.paneId, token);
    const loading = document.createElement("p");
    loading.className = "tape-loading";
    loading.textContent = `Loading ${pane.surfaceKind}…`;
    body.replaceChildren(loading);
    try {
      const handle = await mountPane(body, pane.source, this.contextFor(pane));
      if (this.tokens.get(pane.paneId) !== token) {
        handle.destroy();
        return;
      }
      this.handles.set(pane.paneId, handle);
      handle.update(this.contextFor(pane));
    } catch (error) {
      if (this.tokens.get(pane.paneId) !== token) return;
      body.replaceChildren();
      const pre = document.createElement("pre");
      pre.className = "tape-mount-error";
      pre.textContent = error instanceof Error ? error.message : String(error);
      body.append(pre);
    }
  }

  private hasSplitBelow(box: Box): boolean {
    const column = this.layout.planes
      .find((plane) => plane.index === box.plane)
      ?.columns.find((item) => item.index === box.column);
    return Boolean(column && box.row + 1 < column.cells.length);
  }

  private retarget(): void {
    if (this.resizing) return;
    if (this.compact || this.layout.maximizedPaneId) {
      this.target = { x: 0, y: 0, scale: 1 };
      this.camera = { ...this.target };
      this.applyTransform();
      return;
    }
    if (this.overview) {
      const bounds = sceneBounds(this.scene, this.options.padding);
      const fit = Math.min(this.viewport.width / bounds.width, this.viewport.height / bounds.height);
      const scale = clamp(fit * 0.88 * this.overviewZoom, 0.08, 2.5);
      const camera = cameraFor(bounds, this.viewport, "center", scale);
      this.target = {
        x: camera.x - this.overviewPan.x / scale,
        y: camera.y - this.overviewPan.y / scale,
        scale,
      };
      return;
    }
    const box = cursorBox(this.scene, this.layout.cursor);
    if (!box) return;
    const camera = cameraFor(box, this.viewport, this.options.focusAnchor, 1);
    this.target = { x: camera.x, y: camera.y, scale: 1 };
    if (this.snapNext || this.reduced) {
      this.camera = { ...this.target };
      this.applyTransform();
    }
  }

  private kick(): void {
    if (this.frameId) return;
    this.lastFrame = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(34, now - this.lastFrame);
    this.lastFrame = now;
    const tau = this.overview ? 120 : 78;
    const gain = this.reduced || this.snapNext ? 1 : 1 - Math.exp(-dt / tau);
    const dx = this.target.x - this.camera.x;
    const dy = this.target.y - this.camera.y;
    const ds = this.target.scale - this.camera.scale;
    this.camera.x += dx * gain;
    this.camera.y += dy * gain;
    this.camera.scale += ds * gain;
    this.applyTransform();
    this.paintMinimap();
    const settled = Math.hypot(dx, dy) < 0.6 && Math.abs(ds) < 0.002;
    if (!settled) {
      if (!this.motion) {
        this.motion = true;
        this.syncRuntime();
      }
      this.frameId = requestAnimationFrame(this.frame);
      return;
    }
    this.camera = { ...this.target };
    this.snapNext = false;
    this.motion = false;
    this.frameId = 0;
    this.applyTransform();
    this.syncRuntime();
  };

  private applyTransform(): void {
    if (this.compact || this.layout.maximizedPaneId) {
      this.world.style.transform = "none";
      return;
    }
    this.world.style.transform = `scale(${this.camera.scale}) translate3d(${-this.camera.x}px, ${-this.camera.y}px, 0)`;
  }

  private queueSync(): void {
    if (this.syncQueued) return;
    this.syncQueued = true;
    requestAnimationFrame(() => {
      this.syncQueued = false;
      this.syncRuntime();
    });
  }

  private syncRuntime(): void {
    for (const [id, handle] of this.handles) {
      const pane = this.panes.get(id);
      if (!pane) continue;
      const context = this.contextFor(pane);
      const key = `${context.focused}:${context.visible}:${context.maximized}:${context.runtimeState}:${context.presentationMode}`;
      const shell = this.shells.get(id);
      if (shell) shell.root.dataset.runtime = context.runtimeState;
      if (this.contextKeys.get(id) === key) continue;
      this.contextKeys.set(id, key);
      handle.update(context);
    }
  }

  private contextFor(pane: PaneDefinition): PaneContext {
    const focused = paneAt(this.layout) === pane.paneId;
    const maximized = this.layout.maximizedPaneId === pane.paneId;
    const box = this.scene.boxes.find((item) => item.paneId === pane.paneId);
    let visible = focused;
    if (box && !this.compact && !this.layout.maximizedPaneId) {
      const scale = this.camera.scale || 1;
      const x = (box.x - this.camera.x) * scale;
      const y = (box.y - this.camera.y) * scale;
      visible = x < this.viewport.width && y < this.viewport.height && x + box.width * scale > 0 && y + box.height * scale > 0;
    }
    if (this.layout.maximizedPaneId) visible = maximized;
    if (this.compact) visible = focused;
    let runtimeState: PaneContext["runtimeState"] = "live";
    if (!visible && !focused) runtimeState = "hidden";
    else if (!this.options.liveContent && (this.overview || this.motion || this.resizing)) runtimeState = "frozen";
    const props = "props" in pane.source && pane.source.props ? pane.source.props : {};
    return {
      paneId: pane.paneId,
      title: pane.title,
      surfaceKind: pane.surfaceKind,
      data: pane.data,
      focused,
      visible,
      maximized,
      runtimeState,
      presentationMode: this.compact ? "compact" : this.overview ? "overview" : "normal",
      props,
      emit: (type, detail) => this.bus.emit(pane.paneId, type, detail),
      on: (type, listener) => this.listen(pane.paneId, type, listener),
    };
  }

  private paintMinimap(): void {
    const boxes = this.scene.boxes.filter((box) => box.paneId);
    if (this.overview || this.compact || this.layout.maximizedPaneId || boxes.length === 0) {
      this.minimap.hidden = true;
      return;
    }
    this.minimap.hidden = false;
    const bounds = sceneBounds(this.scene, this.options.padding);
    const key = boxes.map((box) => box.paneId).join("|");
    if (key !== this.minimapKey) {
      this.minimapKey = key;
      this.minimapWorld.replaceChildren();
      for (const box of boxes) {
        if (!box.paneId) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tape-minimap-pane";
        button.dataset.paneId = box.paneId;
        button.tabIndex = -1;
        const id = box.paneId;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.focusPane(id);
        });
        this.minimapWorld.append(button);
      }
      this.minimapWorld.append(this.minimapView);
    }
    const scale = Math.min(152 / bounds.width, 88 / bounds.height);
    const focused = paneAt(this.layout);
    for (const box of boxes) {
      if (!box.paneId) continue;
      const button = this.minimapWorld.querySelector(`[data-pane-id="${CSS.escape(box.paneId)}"]`);
      if (!(button instanceof HTMLElement)) continue;
      button.style.left = `${(box.x - bounds.x) * scale + 8}px`;
      button.style.top = `${(box.y - bounds.y) * scale + 8}px`;
      button.style.width = `${Math.max(6, box.width * scale)}px`;
      button.style.height = `${Math.max(4, box.height * scale)}px`;
      button.classList.toggle("is-focused", box.paneId === focused);
    }
    const viewScale = this.camera.scale || 1;
    this.minimapView.style.left = `${(this.camera.x - bounds.x) * scale + 8}px`;
    this.minimapView.style.top = `${(this.camera.y - bounds.y) * scale + 8}px`;
    this.minimapView.style.width = `${(this.viewport.width / viewScale) * scale}px`;
    this.minimapView.style.height = `${(this.viewport.height / viewScale) * scale}px`;
  }

  private announce(): void {
    const id = paneAt(this.layout);
    const pane = id ? this.panes.get(id) : undefined;
    const plane = this.layout.planes.find((item) => item.index === this.layout.cursor.plane);
    const columns = plane ? [...plane.columns].sort((left, right) => left.index - right.index) : [];
    const ordinal = Math.max(1, columns.findIndex((column) => column.index === this.layout.cursor.column) + 1);
    const where = pane ? pane.title : "Empty cell";
    const mode = this.overview ? "Overview. " : this.layout.maximizedPaneId ? "Maximized. " : "";
    const text = `${mode}${where}. Column ${ordinal} of ${Math.max(columns.length, 1)}.`;
    if (text === this.announced) return;
    this.announced = text;
    this.status.textContent = text;
  }

  private writePaneLink(): void {
    if (!this.options.paneLink) return;
    const url = new URL(location.href);
    const id = paneAt(this.layout);
    if ((id ?? null) === (url.searchParams.get("pane") ?? null)) return;
    if (id) url.searchParams.set("pane", id);
    else url.searchParams.delete("pane");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  private persist(): void {
    this.stashActive();
    if (!this.options.storageKey) return;
    const closed = this.closed.filter((item) => serializable(item.pane.source));
    localStorage.setItem(
      this.options.storageKey,
      JSON.stringify({
        schema: 2,
        activeId: this.activeWorkspaceId,
        workspaces: this.workspaces.map((workspace) => serializableSnapshot(workspace)),
        closed,
      }),
    );
  }

  private handleKey(event: KeyboardEvent): void {
    if (this.dialog.open) {
      if (event.key === "Escape") this.closeDialog();
      return;
    }
    if (this.spotlight.open) {
      this.handleSpotlightKey(event);
      return;
    }
    if (!this.groupMenu.hidden) {
      if (event.key === "Escape" || matchShortcut(event) === "editGroup") {
        event.preventDefault();
        this.closeGroupMenu();
      }
      return;
    }
    if (!this.workspaceMenu.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeWorkspaceMenu();
      }
      return;
    }
    if (matchShortcut(event) === "spotlight") {
      event.preventDefault();
      this.openSpotlight();
      return;
    }
    const editable = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
    if (event.key === "Escape" && !editable) {
      if (this.overview) {
        this.toggleOverview(false);
        event.preventDefault();
        return;
      }
      if (this.group) {
        this.group = false;
        this.render();
        event.preventDefault();
        return;
      }
      if (this.layout.maximizedPaneId) {
        this.apply(toggleMaximized(this.layout));
        event.preventDefault();
      }
      return;
    }
    if (editable) return;
    const action = matchShortcut(event);
    if (!action) return;
    event.preventDefault();
    this.runAction(action);
  }

  private runAction(action: ShortcutAction): void {
    const width = this.columnWidth();
    switch (action) {
      case "focusLeft":
        this.apply(focusBy(this.layout, -1, 0, this.options.runway));
        break;
      case "focusRight":
        this.apply(focusBy(this.layout, 1, 0, this.options.runway));
        break;
      case "focusUp":
        this.apply(focusBy(this.layout, 0, -1, this.options.runway));
        break;
      case "focusDown":
        this.apply(focusBy(this.layout, 0, 1, this.options.runway));
        break;
      case "focusFirst":
        this.apply(focusEdge(this.layout, "first"));
        break;
      case "focusLast":
        this.apply(focusEdge(this.layout, "last"));
        break;
      case "moveLeft":
        this.apply(movePane(this.layout, -1, 0, width));
        break;
      case "moveRight":
        this.apply(movePane(this.layout, 1, 0, width));
        break;
      case "moveUp":
        this.apply(movePane(this.layout, 0, -1, width));
        break;
      case "moveDown":
        this.apply(movePane(this.layout, 0, 1, width));
        break;
      case "groupLeft":
        if (this.group) this.apply(moveColumn(this.layout, -1, 0));
        break;
      case "groupRight":
        if (this.group) this.apply(moveColumn(this.layout, 1, 0));
        break;
      case "groupUp":
        if (this.group) this.apply(moveColumn(this.layout, 0, -1));
        break;
      case "groupDown":
        if (this.group) this.apply(moveColumn(this.layout, 0, 1));
        break;
      case "splitRight":
        this.apply(splitBlank(this.layout, "right", width));
        break;
      case "splitDown":
        this.apply(splitBlank(this.layout, "down", width));
        break;
      case "splitUp":
        this.apply(splitBlank(this.layout, "up", width));
        break;
      case "splitPlaneDown":
        this.apply(splitPlane(this.layout, 1, width));
        break;
      case "splitPlaneUp":
        this.apply(splitPlane(this.layout, -1, width));
        break;
      case "insertLeft":
        this.apply(insertAsSplit(this.layout, -1, width));
        break;
      case "insertRight":
        this.apply(insertAsSplit(this.layout, 1, width));
        break;
      case "removeBlankUp":
        this.apply(removeBlank(this.layout, "up"));
        break;
      case "removeBlankDown":
        this.apply(removeBlank(this.layout, "down"));
        break;
      case "selectGroup":
        this.group = !this.group;
        this.render();
        break;
      case "editGroup":
        this.openGroupMenu();
        break;
      case "groupNext":
        this.cycleActiveGroup(1);
        break;
      case "groupPrev":
        this.cycleActiveGroup(-1);
        break;
      case "home":
        this.goHome();
        break;
      case "overview":
        this.toggleOverview();
        break;
      case "maximize":
        this.apply(toggleMaximized(this.layout));
        break;
      case "spotlight":
        this.openSpotlight();
        break;
      case "closePane":
        this.closeFocused();
        break;
      case "reopenPane":
        this.reopenClosed();
        break;
      case "historyBack":
        this.travel(-1);
        break;
      case "historyForward":
        this.travel(1);
        break;
    }
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.overview) return;
    event.preventDefault();
    this.overviewZoom = clamp(this.overviewZoom * Math.exp(-event.deltaY * 0.0012), 0.45, 2.6);
    this.retarget();
    this.kick();
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const target = event.target;
    if (target.closest(".tape-controls, .tape-minimap, .tape-dialog, .tape-spotlight")) return;
    const resize = target.closest(".tape-resize");
    const shell = target.closest(".tape-pane, .tape-ghost");
    if (!(shell instanceof HTMLElement) && !(resize instanceof HTMLElement)) {
      if (this.overview) {
        this.gesture = this.blankGesture(event, "pan", null);
        this.stage.setPointerCapture(event.pointerId);
      }
      return;
    }
    const node = (resize ?? shell) as HTMLElement;
    const owner = node.closest(".tape-pane, .tape-ghost");
    if (!(owner instanceof HTMLElement)) return;
    const cursor = readCursor(owner);
    const paneId = owner.dataset.paneId ?? null;
    if (resize instanceof HTMLElement) {
      const edge = resize.dataset.edge === "bottom" ? "resize-y" : "resize-x";
      const column = this.layout.planes
        .find((plane) => plane.index === cursor.plane)
        ?.columns.find((item) => item.index === cursor.column);
      const above = column?.cells[cursor.row];
      const below = column?.cells[cursor.row + 1];
      this.resizing = true;
      this.gesture = {
        ...this.blankGesture(event, edge, paneId),
        cursor,
        width: column?.widthPx ?? this.columnWidth(),
        weights: [above?.weight ?? 1, below?.weight ?? 1],
      };
      this.stage.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const onChrome = target.closest(".tape-pane-bar, .tape-ghost");
    const onField = target.closest("input, textarea, select, button, a, [contenteditable='true']");
    if (!onChrome || onField) {
      if (paneId) this.focusPane(paneId);
      else this.apply(focusByCursor(this.layout, cursor));
      if (this.overview && paneId) this.toggleOverview(false);
      return;
    }
    this.gesture = { ...this.blankGesture(event, "press", paneId), cursor };
    this.stage.setPointerCapture(event.pointerId);
  }

  private handlePointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) > 6) gesture.moved = true;
    if (gesture.kind === "press" && gesture.moved && gesture.paneId && !this.overview) gesture.kind = "move";
    if (gesture.kind === "resize-x") {
      this.layout = resizeColumn(gesture.layout, gesture.cursor, gesture.width + dx / (this.camera.scale || 1));
      this.render();
      return;
    }
    if (gesture.kind === "resize-y") {
      const sum = gesture.weights[0] + gesture.weights[1];
      const delta = (dy / Math.max(240, this.viewport.height - this.options.padding * 2)) * sum;
      this.layout = resizeSplit(gesture.layout, gesture.cursor, delta);
      this.render();
      return;
    }
    if (gesture.kind === "pan" && this.overview) {
      this.overviewPan = { x: gesture.pan.x + dx, y: gesture.pan.y + dy };
      this.retarget();
      this.snapNext = true;
      this.kick();
      return;
    }
    if (gesture.kind === "move") {
      const box = this.boxAt(event.clientX, event.clientY);
      const key = box ? boxKey(box) : "";
      if (key !== this.dropKey) {
        this.dropKey = key;
        this.render();
      }
      const shell = gesture.paneId ? this.shells.get(gesture.paneId) : undefined;
      shell?.root.classList.add("is-dragging");
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.id) return;
    this.gesture = null;
    if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId);
    if (gesture.kind === "resize-x" || gesture.kind === "resize-y") {
      this.resizing = false;
      this.persist();
      this.options.onLayoutChange?.(this.layout);
      this.retarget();
      this.kick();
      this.syncRuntime();
      return;
    }
    if (gesture.kind === "move" && gesture.paneId) {
      const box = this.boxAt(event.clientX, event.clientY);
      this.dropKey = "";
      if (box && !(box.paneId === gesture.paneId && box.row === gesture.cursor.row && box.column === gesture.cursor.column)) {
        this.apply(relocatePane(this.layout, gesture.paneId, { plane: box.plane, column: box.column, row: box.row }));
      } else {
        this.render();
      }
      return;
    }
    if (gesture.kind === "press") {
      if (this.overview) {
        this.overview = false;
        if (gesture.paneId) this.apply(focusInLayout(this.layout, gesture.paneId));
        else this.apply(focusByCursor(this.layout, gesture.cursor));
        return;
      }
      if (gesture.paneId) this.focusPane(gesture.paneId);
      else this.apply(focusByCursor(this.layout, gesture.cursor));
    }
  }

  private boxAt(clientX: number, clientY: number): Box | undefined {
    const rect = this.stage.getBoundingClientRect();
    const scale = this.camera.scale || 1;
    const x = (clientX - rect.left) / scale + this.camera.x;
    const y = (clientY - rect.top) / scale + this.camera.y;
    return this.scene.boxes.find(
      (box) => x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height,
    );
  }

  private blankGesture(event: PointerEvent, kind: Gesture["kind"], paneId: string | null): Gesture {
    return {
      kind,
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cursor: this.layout.cursor,
      paneId,
      layout: this.layout,
      width: this.columnWidth(),
      weights: [1, 1],
      pan: { ...this.overviewPan },
      moved: false,
    };
  }

  private openGroupMenu(paneId?: string): void {
    const id = paneId ?? paneAt(this.layout);
    if (!id) return;
    this.closeWorkspaceMenu();
    this.groupMenuPaneId = id;
    this.groupMenu.hidden = false;
    this.groupMenuInput.value = "";
    this.paintGroupMenu();
    this.groupMenuInput.focus();
  }

  private closeGroupMenu(): void {
    this.groupMenu.hidden = true;
    this.groupMenuPaneId = null;
  }

  private assignMenuPane(groupId: string): void {
    const paneId = this.groupMenuPaneId;
    if (!paneId) return;
    this.closeGroupMenu();
    this.activeGroupId = groupId;
    this.apply(withGroups(this.layout, assignPane(this.layout.groups, paneId, groupId)));
  }

  private ungroupMenuPane(): void {
    const paneId = this.groupMenuPaneId;
    if (!paneId) return;
    this.closeGroupMenu();
    this.apply(withGroups(this.layout, ungroupPane(this.layout.groups, paneId)));
  }

  private createMenuGroup(name: string): void {
    const paneId = this.groupMenuPaneId;
    if (!paneId) return;
    const groups = addPaneToGroup(this.layout.groups, name, paneId);
    const created = groupOf(groups, paneId);
    this.closeGroupMenu();
    if (created) this.activeGroupId = created.id;
    this.apply(withGroups(this.layout, groups));
  }

  private showGroup(groupId: string | null): void {
    if (!groupId) {
      this.activeGroupId = null;
      this.render();
      return;
    }
    const group = this.layout.groups.find((item) => item.id === groupId);
    if (!group) return;
    if (this.activeGroupId !== groupId) {
      this.activeGroupId = groupId;
      const first = orderedMembers(this.layout, group)[0];
      if (first) this.apply(focusInLayout(this.layout, first));
      else this.render();
      return;
    }
    this.cycleActiveGroup(1);
  }

  private cycleActiveGroup(delta: number): void {
    const current = paneAt(this.layout);
    const group = (current && groupOf(this.layout.groups, current)) || this.layout.groups.find((item) => item.id === this.activeGroupId);
    if (!group) return;
    const next = cycleMember(this.layout, group.id, current, delta);
    this.activeGroupId = group.id;
    if (!next || next === current) {
      this.render();
      return;
    }
    this.apply(focusInLayout(this.layout, next));
  }

  private paintGroupBar(): void {
    this.groupBar.replaceChildren();
    if (this.layout.groups.length === 0) {
      this.groupBar.hidden = true;
      return;
    }
    this.groupBar.hidden = false;
    const all = document.createElement("button");
    all.type = "button";
    all.className = "tape-group-chip";
    all.textContent = "All";
    all.setAttribute("aria-pressed", String(this.activeGroupId === null));
    all.addEventListener("click", () => this.showGroup(null));
    this.groupBar.append(all);
    for (const group of this.layout.groups) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tape-group-chip";
      chip.style.setProperty("--pane-group", group.color);
      chip.setAttribute("aria-pressed", String(this.activeGroupId === group.id));
      const dot = document.createElement("span");
      dot.className = "tape-group-dot";
      const count = document.createElement("span");
      count.className = "tape-group-count";
      count.textContent = String(group.paneIds.length);
      chip.append(dot, document.createTextNode(group.name), count);
      chip.addEventListener("click", () => this.showGroup(group.id));
      this.groupBar.append(chip);
    }
  }

  private paintGroupMenu(): void {
    const paneId = this.groupMenuPaneId;
    const pane = paneId ? this.panes.get(paneId) : undefined;
    const membership = paneId ? groupOf(this.layout.groups, paneId) : undefined;
    this.groupMenuTitle.textContent = pane ? `Group “${pane.title}”` : "Group this pane";
    this.groupMenuRemove.hidden = !membership;
    this.groupMenuRemove.textContent = membership ? `Remove from ${membership.name}` : "Remove";
    this.groupMenuList.replaceChildren();
    for (const group of this.layout.groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tape-group-choice";
      button.style.setProperty("--pane-group", group.color);
      button.setAttribute("aria-pressed", String(membership?.id === group.id));
      button.textContent = `${group.name} · ${group.paneIds.length}`;
      button.addEventListener("click", () => this.assignMenuPane(group.id));
      this.groupMenuList.append(button);
    }
  }

  private openSpotlight(): void {
    if (this.spotlight.open) {
      this.spotlightInput.focus();
      return;
    }
    this.closeGroupMenu();
    this.closeWorkspaceMenu();
    if (this.dialog.open) this.closeDialog();
    this.spotlightIndex = 0;
    this.spotlightInput.value = "";
    this.renderSpotlight();
    this.spotlight.showModal();
    this.spotlightInput.focus();
    this.spotlightInput.select();
  }

  private closeSpotlight(): void {
    if (this.spotlight.open) this.spotlight.close();
    this.stage.focus({ preventScroll: true });
  }

  private handleSpotlightKey(event: KeyboardEvent): void {
    if (matchShortcut(event) === "spotlight" || event.key === "Escape") {
      event.preventDefault();
      this.closeSpotlight();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.moveSpotlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.chooseSpotlight();
    }
  }

  private moveSpotlight(delta: number): void {
    if (this.spotlightHits.length === 0) return;
    this.spotlightIndex = Math.min(this.spotlightHits.length - 1, Math.max(0, this.spotlightIndex + delta));
    this.paintSpotlightSelection();
  }

  private chooseSpotlight(): void {
    const hit = this.spotlightHits[this.spotlightIndex];
    if (!hit) return;
    this.closeSpotlight();
    if (hit.kind === "pane") this.focusPane(hit.id);
    else if (hit.kind === "closed") this.reopenClosed(hit.id);
    else if (hit.kind === "workspace") this.switchWorkspace(hit.id);
    else this.runCommand(hit.id);
  }

  private renderSpotlight(): void {
    this.spotlightHits = searchPalette(this.paletteEntries(), this.spotlightInput.value, paneAt(this.layout));
    if (this.spotlightIndex > this.spotlightHits.length - 1) this.spotlightIndex = 0;
    this.spotlightList.replaceChildren();
    this.spotlightHits.forEach((hit, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "tape-spotlight-option";
      option.id = `tape-spot-${index}`;
      option.setAttribute("role", "option");
      const kind = document.createElement("span");
      kind.className = "tape-spotlight-kind";
      kind.textContent = hit.kindLabel;
      const title = document.createElement("span");
      title.className = "tape-spotlight-title";
      title.append(markedText(hit.title, hit.titleMarks));
      const where = document.createElement("span");
      where.className = "tape-spotlight-where";
      where.textContent = hit.where;
      option.append(kind, title, where);
      option.addEventListener("mouseenter", () => {
        this.spotlightIndex = index;
        this.paintSpotlightSelection();
      });
      option.addEventListener("click", () => {
        this.spotlightIndex = index;
        this.chooseSpotlight();
      });
      this.spotlightList.append(option);
    });
    const empty = this.spotlightHits.length === 0;
    this.spotlightEmpty.hidden = !empty;
    this.spotlightList.hidden = empty;
    this.paintSpotlightSelection();
  }

  private paintSpotlightSelection(): void {
    const options = [...this.spotlightList.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    for (const [index, option] of options.entries()) {
      const selected = index === this.spotlightIndex;
      option.setAttribute("aria-selected", String(selected));
      if (!selected) continue;
      option.scrollIntoView({ block: "nearest" });
      this.spotlightInput.setAttribute("aria-activedescendant", option.id);
    }
    if (options.length === 0) this.spotlightInput.removeAttribute("aria-activedescendant");
  }

  private placeLabel(paneId: string): string {
    const cursor = findCursor(this.layout, paneId);
    if (!cursor) return "";
    const plane = this.layout.planes.find((item) => item.index === cursor.plane);
    const columns = plane ? [...plane.columns].sort((left, right) => left.index - right.index) : [];
    const ordinal = Math.max(1, columns.findIndex((column) => column.index === cursor.column) + 1);
    const depth = columns.find((column) => column.index === cursor.column)?.cells.length ?? 1;
    const column = `Column ${ordinal}`;
    return depth > 1 ? `${column} · row ${cursor.row + 1}` : column;
  }

  private openDialog(): void {
    const title = this.dialog.querySelector<HTMLInputElement>('input[name="title"]');
    this.dialog.showModal();
    title?.focus();
  }

  private closeDialog(): void {
    if (this.dialog.open) this.dialog.close();
    this.stage.focus({ preventScroll: true });
  }

  private clearShells(): void {
    for (const handle of this.handles.values()) handle.destroy();
    this.handles.clear();
    for (const shell of this.shells.values()) shell.root.remove();
    this.shells.clear();
    this.tokens.clear();
    this.contextKeys.clear();
    this.bus.clear();
    this.busStops.clear();
  }

  private closeFocused(): void {
    const id = paneAt(this.layout);
    if (id) this.closePane(id);
  }

  private reopenClosed(paneId?: string): void {
    const index = paneId ? this.closed.findIndex((item) => item.pane.paneId === paneId) : 0;
    if (index < 0 || !this.closed[index]) return;
    const [record] = this.closed.splice(index, 1);
    if (!record) return;
    const id = uniqueId(record.pane.paneId, this.panes);
    const pane = { ...copyPane(record.pane), paneId: id };
    this.panes.set(id, pane);
    let next = openPaneAt(this.layout, id, record.cursor, this.columnWidth());
    if (record.groupId && next.groups.some((group) => group.id === record.groupId)) {
      next = withGroups(next, assignPane(next.groups, id, record.groupId));
    }
    this.apply(next);
  }

  private travel(direction: -1 | 1): void {
    const alive = (id: string) => findCursor(this.layout, id) !== null;
    const current = paneAt(this.layout);
    const step = direction < 0 ? stepBack(this.trail, current, alive) : stepForward(this.trail, current, alive);
    this.trail = step.trail;
    if (!step.target) return;
    this.suppressHistory = true;
    this.focusPane(step.target);
    this.suppressHistory = false;
  }

  private listen(paneId: string, type: string, listener: (event: PaneBusEvent) => void): () => void {
    const stop = this.bus.on(type, listener);
    const stops = this.busStops.get(paneId) ?? new Set();
    stops.add(stop);
    this.busStops.set(paneId, stops);
    return () => {
      stop();
      stops.delete(stop);
    };
  }

  private releaseBus(paneId: string): void {
    for (const stop of this.busStops.get(paneId) ?? []) stop();
    this.busStops.delete(paneId);
  }

  private paletteEntries() {
    const commands: { id: string; title: string; keywords: string; shortcut?: ShortcutAction }[] = [
      { id: "new-pane", title: "New pane", keywords: "open create load" },
      { id: "close-pane", title: "Close pane", keywords: "remove delete", shortcut: "closePane" },
      { id: "reopen-pane", title: "Reopen closed pane", keywords: "undo restore", shortcut: "reopenPane" },
      { id: "back", title: "Back", keywords: "history previous", shortcut: "historyBack" },
      { id: "forward", title: "Forward", keywords: "history next", shortcut: "historyForward" },
      { id: "group", title: "Group the focused pane", keywords: "tag set", shortcut: "editGroup" },
      { id: "overview", title: "Overview", keywords: "zoom all panes", shortcut: "overview" },
      { id: "maximize", title: "Maximize", keywords: "fill stage", shortcut: "maximize" },
      { id: "home", title: "Return home", keywords: "first pane", shortcut: "home" },
      { id: "reset", title: "Reset workspace", keywords: "restore original panes" },
      { id: "new-workspace", title: "New workspace", keywords: "space layout" },
      { id: "rename-workspace", title: "Rename workspace", keywords: "space name" },
      { id: "export-layout", title: "Export layout", keywords: "download json save" },
      { id: "import-layout", title: "Import layout", keywords: "upload json open file" },
    ];
    return [
      ...paneIds(this.layout).map((id) => {
        const pane = this.panes.get(id);
        const membership = groupOf(this.layout.groups, id)?.name;
        return {
          id,
          kind: "pane" as const,
          title: pane?.title ?? id,
          kindLabel: pane?.surfaceKind ?? "pane",
          where: [membership, this.placeLabel(id)].filter(Boolean).join(" · "),
          keywords: membership ?? "",
        };
      }),
      ...this.closed.map((record) => ({
        id: record.pane.paneId,
        kind: "closed" as const,
        title: record.pane.title,
        kindLabel: "closed",
        where: "Reopen",
        keywords: record.pane.surfaceKind,
      })),
      ...this.workspaces.map((workspace) => ({
        id: workspace.id,
        kind: "workspace" as const,
        title: workspace.name,
        kindLabel: "space",
        where: workspace.id === this.activeWorkspaceId ? "Current" : "Switch",
        keywords: "workspace",
      })),
      ...commands.map((command) => ({
        id: command.id,
        kind: "command" as const,
        title: command.title,
        kindLabel: "command",
        where: command.shortcut ? shortcutLabel(command.shortcut, apple) : "",
        keywords: command.keywords,
      })),
    ];
  }

  private runCommand(id: string): void {
    switch (id) {
      case "new-pane":
        this.openDialog();
        break;
      case "close-pane":
        this.closeFocused();
        break;
      case "reopen-pane":
        this.reopenClosed();
        break;
      case "back":
        this.travel(-1);
        break;
      case "forward":
        this.travel(1);
        break;
      case "group":
        this.openGroupMenu();
        break;
      case "overview":
        this.toggleOverview();
        break;
      case "maximize":
        this.apply(toggleMaximized(this.layout));
        break;
      case "home":
        this.goHome();
        break;
      case "reset":
        this.reset();
        break;
      case "new-workspace":
        this.openWorkspaceMenu(true);
        break;
      case "rename-workspace":
        this.openWorkspaceMenu(false);
        break;
      case "export-layout":
        this.exportLayout();
        break;
      case "import-layout":
        this.importInput.click();
        break;
    }
  }

  private stashActive(): void {
    const panes: PaneDefinition[] = [];
    for (const id of paneIds(this.layout)) {
      const pane = this.panes.get(id);
      if (pane) panes.push(copyPane(pane));
    }
    const snapshot: WorkspaceSnapshot = {
      id: this.activeWorkspaceId,
      name: this.workspaceName(),
      layout: structuredClone(this.layout),
      panes,
    };
    const index = this.workspaces.findIndex((item) => item.id === snapshot.id);
    if (index >= 0) this.workspaces[index] = snapshot;
    else this.workspaces.push(snapshot);
  }

  private rememberActive(): void {
    if (this.workspaces.some((item) => item.id === this.activeWorkspaceId)) return;
    this.workspaces.push({
      id: this.activeWorkspaceId,
      name: "Main",
      layout: structuredClone(this.layout),
      panes: [...this.panes.values()].map((pane) => copyPane(pane)),
    });
  }

  private loadSnapshot(snapshot: WorkspaceSnapshot): void {
    this.activeWorkspaceId = snapshot.id;
    this.layout = structuredClone(snapshot.layout);
    this.panes.clear();
    for (const pane of snapshot.panes) this.panes.set(pane.paneId, copyPane(pane));
    for (const id of paneIds(this.layout)) {
      if (!this.panes.has(id)) this.panes.set(id, missingPane(id));
    }
    this.trail = emptyTrail();
  }

  private workspaceName(): string {
    return this.workspaces.find((item) => item.id === this.activeWorkspaceId)?.name ?? "Main";
  }

  private toggleWorkspaceMenu(): void {
    if (this.workspaceMenu.hidden) this.openWorkspaceMenu(true);
    else this.closeWorkspaceMenu();
  }

  private openWorkspaceMenu(create: boolean): void {
    this.closeGroupMenu();
    this.workspaceMenu.hidden = false;
    this.workspaceNameInput.value = this.workspaceName();
    this.paintWorkspaceMenu();
    this.paintWorkspaceButton();
    const field = create ? this.workspaceMenu.querySelector<HTMLInputElement>('input[name="workspace"]') : this.workspaceNameInput;
    field?.focus();
    field?.select();
  }

  private closeWorkspaceMenu(): void {
    this.workspaceMenu.hidden = true;
    this.paintWorkspaceButton();
  }

  private paintWorkspaceButton(): void {
    const name = this.workspaceName();
    this.workspaceButton.textContent = name;
    this.workspaceButton.title = `Workspace ${name}`;
    this.workspaceButton.setAttribute("aria-label", `Workspace ${name}`);
    this.workspaceButton.setAttribute("aria-pressed", String(!this.workspaceMenu.hidden));
  }

  private paintWorkspaceMenu(): void {
    this.workspaceMenuList.replaceChildren();
    for (const workspace of this.workspaces) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tape-group-choice";
      button.textContent = workspace.name;
      button.setAttribute("aria-pressed", String(workspace.id === this.activeWorkspaceId));
      button.addEventListener("click", () => this.switchWorkspace(workspace.id));
      this.workspaceMenuList.append(button);
    }
  }

  private switchWorkspace(id: string): void {
    if (id === this.activeWorkspaceId) {
      this.closeWorkspaceMenu();
      return;
    }
    const next = this.workspaces.find((item) => item.id === id);
    if (!next) return;
    this.stashActive();
    this.overview = false;
    this.group = false;
    this.activeGroupId = null;
    this.closeGroupMenu();
    this.loadSnapshot(next);
    this.snapNext = true;
    this.clearShells();
    this.render();
    this.persist();
    this.announce();
    this.writePaneLink();
    this.closeWorkspaceMenu();
  }

  private createWorkspace(name: string): void {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    this.stashActive();
    const id = workspaceIdFor(trimmed, new Set(this.workspaces.map((item) => item.id)));
    this.activeWorkspaceId = id;
    this.workspaces.push({ id, name: trimmed, layout: this.layout, panes: [] });
    this.overview = false;
    this.group = false;
    this.activeGroupId = null;
    this.closeGroupMenu();
    this.useInitial();
    this.snapNext = true;
    this.clearShells();
    this.render();
    this.persist();
    this.announce();
    this.writePaneLink();
    this.closeWorkspaceMenu();
  }

  private renameWorkspace(name: string): void {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    const current = this.workspaces.find((item) => item.id === this.activeWorkspaceId);
    if (current) current.name = trimmed;
    else this.rememberActive();
    const created = this.workspaces.find((item) => item.id === this.activeWorkspaceId);
    if (created) created.name = trimmed;
    this.persist();
    this.paintWorkspaceButton();
    this.paintWorkspaceMenu();
  }

  private exportLayout(): void {
    this.stashActive();
    const current = this.workspaces.find((item) => item.id === this.activeWorkspaceId);
    if (!current) return;
    const blob = new Blob([exportDocument(current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workspaceIdFor(current.name, new Set())}.json`;
    this.root.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private async importLayout(file: File): Promise<void> {
    const parsed = parseLayoutFile(await file.text());
    if (!parsed) return;
    this.overview = false;
    this.group = false;
    this.activeGroupId = null;
    this.closeGroupMenu();
    this.panes.clear();
    for (const pane of parsed.panes) this.panes.set(pane.paneId, copyPane(pane));
    this.layout = structuredClone(parsed.layout);
    this.layout.workspaceId = this.activeWorkspaceId;
    for (const id of paneIds(this.layout)) {
      if (!this.panes.has(id)) this.panes.set(id, missingPane(id));
    }
    this.trail = emptyTrail();
    this.snapNext = true;
    this.clearShells();
    this.render();
    this.persist();
    this.announce();
    this.writePaneLink();
    this.closeWorkspaceMenu();
  }

  private columnWidth(): number {
    return defaultColumnWidth(this.viewport.width || window.innerWidth);
  }
}

function place(
  node: HTMLElement,
  box: Box,
  cover: boolean,
  viewport: { width: number; height: number },
  compact: boolean,
): void {
  node.dataset.plane = String(box.plane);
  node.dataset.column = String(box.column);
  node.dataset.row = String(box.row);
  if (cover) {
    const inset = compact ? 0 : 12;
    node.style.left = `${inset}px`;
    node.style.top = `${inset}px`;
    node.style.width = `${Math.max(0, viewport.width - inset * 2)}px`;
    node.style.height = `${Math.max(0, viewport.height - inset * 2)}px`;
    return;
  }
  node.style.left = `${box.x}px`;
  node.style.top = `${box.y}px`;
  node.style.width = `${box.width}px`;
  node.style.height = `${box.height}px`;
}

function focusByCursor(layout: Layout, cursor: Cursor): Layout {
  if (
    layout.cursor.plane === cursor.plane &&
    layout.cursor.column === cursor.column &&
    layout.cursor.row === cursor.row
  ) {
    return layout;
  }
  const next = structuredClone(layout);
  next.cursor = cursor;
  if (next.maximizedPaneId) next.maximizedPaneId = paneAt(next);
  return next;
}

function paneAt(layout: Layout): string | null {
  for (const plane of layout.planes) {
    if (plane.index !== layout.cursor.plane) continue;
    for (const column of plane.columns) {
      if (column.index !== layout.cursor.column) continue;
      return column.cells[layout.cursor.row]?.paneId ?? null;
    }
  }
  return null;
}

function sameCursor(box: Box, cursor: Cursor): boolean {
  return box.plane === cursor.plane && box.column === cursor.column && box.row === cursor.row;
}

function boxKey(box: Box): string {
  return `${box.plane}:${box.column}:${box.row}:${box.paneId ?? ""}`;
}

function readCursor(node: HTMLElement): Cursor {
  return {
    plane: Number(node.dataset.plane ?? 0),
    column: Number(node.dataset.column ?? 0),
    row: Number(node.dataset.row ?? 0),
  };
}

/** Copy a pane without dropping a live component function. */
function copyPane(pane: PaneDefinition): PaneDefinition {
  switch (pane.source.kind) {
    case "html":
    case "element":
    case "module":
      return structuredClone(pane);
    case "mount":
      return { ...pane, source: { ...pane.source } };
    case "react":
    case "vue":
    case "svelte":
      return {
        ...pane,
        source: {
          ...pane.source,
          props: pane.source.props ? { ...pane.source.props } : undefined,
        },
      };
  }
}

function uniqueId(base: string, panes: Map<string, PaneDefinition>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pane";
  if (!panes.has(slug)) return slug;
  let n = 2;
  while (panes.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

function serializable(source: PaneSource): boolean {
  return source.kind === "html" || source.kind === "element" || source.kind === "module";
}

function isPane(value: unknown): value is PaneDefinition {
  if (!value || typeof value !== "object") return false;
  const pane = value as Partial<PaneDefinition>;
  return typeof pane.paneId === "string" && typeof pane.title === "string" && typeof pane.surfaceKind === "string" && !!pane.source;
}

function missingPane(id: string): PaneDefinition {
  return {
    paneId: id,
    title: "Missing pane",
    surfaceKind: "missing",
    source: {
      kind: "html",
      html: `<p class="tape-mount-error">Nothing is saved for “${escapeHtml(id)}”.</p>`,
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function label(action: ShortcutAction, text: string): string {
  return `${text} (${shortcutLabel(action, apple)})`;
}

function command(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tape-command";
  button.textContent = text;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function iconButton(title: string, path: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tape-icon-button";
  button.title = title;
  button.setAttribute("aria-label", title);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", "none");
  shape.setAttribute("stroke", "currentColor");
  shape.setAttribute("stroke-width", "1.8");
  shape.setAttribute("stroke-linecap", "round");
  svg.append(shape);
  button.append(svg);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function mark(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "tape-mark";
  const logo = document.createElement("span");
  logo.className = "tape-logo";
  logo.setAttribute("aria-hidden", "true");
  const name = document.createElement("strong");
  name.textContent = "niri-js";
  const sub = document.createElement("span");
  sub.textContent = "spatial panes";
  wrap.append(logo, name, sub);
  return wrap;
}

function hint(mac: boolean): HTMLElement {
  const node = document.createElement("p");
  node.className = "tape-hint";
  node.textContent = mac ? "⌥ arrows move · ⌘K commands" : "Alt+arrows move · Ctrl+K commands";
  return node;
}

function buildGroupMenu(
  onRemove: () => void,
  onCreate: (name: string) => void,
): {
  root: HTMLElement;
  title: HTMLElement;
  list: HTMLElement;
  remove: HTMLButtonElement;
  input: HTMLInputElement;
} {
  const root = document.createElement("div");
  root.className = "tape-group-menu";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Group this pane");
  const title = document.createElement("p");
  title.className = "tape-group-menu-title";
  const list = document.createElement("div");
  list.className = "tape-group-menu-list";
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.type = "text";
  input.name = "group";
  input.placeholder = "New group";
  input.setAttribute("aria-label", "New group name");
  const add = document.createElement("button");
  add.type = "submit";
  add.textContent = "Add";
  form.append(input, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    onCreate(name);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "tape-group-remove";
  remove.hidden = true;
  remove.addEventListener("click", onRemove);
  root.append(title, list, form, remove);
  return { root, title, list, remove, input };
}

function buildWorkspaceMenu(
  onCreate: (name: string) => void,
  onRename: (name: string) => void,
  onExport: () => void,
  onImport: () => void,
): { root: HTMLElement; list: HTMLElement; rename: HTMLInputElement } {
  const root = document.createElement("div");
  root.className = "tape-workspace-menu";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Workspaces");
  const list = document.createElement("div");
  list.className = "tape-group-menu-list";
  const create = document.createElement("form");
  const name = document.createElement("input");
  name.type = "text";
  name.name = "workspace";
  name.placeholder = "New workspace";
  name.setAttribute("aria-label", "New workspace name");
  const add = document.createElement("button");
  add.type = "submit";
  add.textContent = "Create";
  create.append(name, add);
  create.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = name.value.trim();
    if (!value) return;
    name.value = "";
    onCreate(value);
  });
  const renameForm = document.createElement("form");
  const rename = document.createElement("input");
  rename.type = "text";
  rename.name = "rename";
  rename.setAttribute("aria-label", "Rename workspace");
  const renameButton = document.createElement("button");
  renameButton.type = "submit";
  renameButton.textContent = "Rename";
  renameForm.append(rename, renameButton);
  renameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    onRename(rename.value);
  });
  const extras = document.createElement("div");
  extras.className = "tape-workspace-files";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export";
  exportButton.addEventListener("click", onExport);
  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.textContent = "Import";
  importButton.addEventListener("click", onImport);
  extras.append(exportButton, importButton);
  root.append(list, create, renameForm, extras);
  return { root, list, rename };
}

function markedText(title: string, marks: readonly number[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marked = new Set(marks);
  let buffer = "";
  let marking = false;
  const flush = (mark: boolean) => {
    if (!buffer) return;
    if (mark) {
      const node = document.createElement("mark");
      node.textContent = buffer;
      fragment.append(node);
    } else {
      fragment.append(document.createTextNode(buffer));
    }
    buffer = "";
  };
  for (let index = 0; index < title.length; index += 1) {
    const on = marked.has(index);
    if (on !== marking) {
      flush(marking);
      marking = on;
    }
    buffer += title[index] ?? "";
  }
  flush(marking);
  return fragment;
}

interface SpotlightShell {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
  empty: HTMLParagraphElement;
}

function buildSpotlight(): SpotlightShell {
  const dialog = document.createElement("dialog");
  dialog.className = "tape-spotlight";
  const form = document.createElement("form");
  form.className = "tape-spotlight-card";
  form.setAttribute("role", "search");
  const input = document.createElement("input");
  input.type = "text";
  input.name = "spotlight";
  input.placeholder = "Search panes and commands";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "tape-spotlight-list");
  input.setAttribute("aria-label", "Search panes and commands");
  const list = document.createElement("ul");
  list.id = "tape-spotlight-list";
  list.className = "tape-spotlight-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Results");
  const empty = document.createElement("p");
  empty.className = "tape-spotlight-empty";
  empty.textContent = "Nothing matches";
  empty.hidden = true;
  form.append(input, list, empty);
  dialog.append(form);
  return { dialog, form, input, list, empty };
}

function buildDialog(
  samples: readonly PaneDefinition[],
  onSample: (pane: PaneDefinition) => void,
  onCreate: (pane: PaneDefinition) => void,
  onCancel: () => void,
): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "tape-dialog";
  const form = document.createElement("form");
  form.className = "tape-dialog-card";
  form.method = "dialog";
  const heading = document.createElement("h2");
  heading.textContent = "New pane";
  const sampleRow = document.createElement("div");
  sampleRow.className = "tape-samples";
  for (const sample of samples) {
    if (sample.paneId === "guide") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = sample.title;
    button.addEventListener("click", () => onSample({ ...copyPane(sample), paneId: sample.surfaceKind }));
    sampleRow.append(button);
  }
  const title = field("Title", "text", "title", "Notes");
  const kind = document.createElement("label");
  kind.textContent = "Kind";
  const select = document.createElement("select");
  select.name = "kind";
  for (const [value, text] of [
    ["react", "React file"],
    ["vue", "Vue file"],
    ["svelte", "Svelte file"],
    ["element", "Web component"],
    ["html", "HTML"],
    ["module", "Module URL"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  kind.append(select);
  const source = field("Source", "text", "source", "panes/ledger.tsx");
  const help = document.createElement("p");
  help.className = "tape-dialog-help";
  const syncHelp = () => {
    help.textContent =
      select.value === "element"
        ? "A tag such as my-widget, or a project file that exports the element."
        : select.value === "html"
          ? "Markup to place in the pane."
          : select.value === "module"
            ? "A URL that exports mount(host, context), or a project file."
            : "A project file, for example panes/ledger.tsx.";
    const input = source.querySelector("input");
    if (input) {
      input.placeholder =
        select.value === "element" ? "my-widget" : select.value === "html" ? "<p>Hello</p>" : "panes/app.tsx";
    }
  };
  select.addEventListener("change", syncHelp);
  syncHelp();
  const footer = document.createElement("footer");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", onCancel);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Open";
  footer.append(cancel, submit);
  form.append(heading, sampleRow, title, kind, source, help, footer);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("title") || "Pane");
    const selected = String(data.get("kind") || "react");
    const value = String(data.get("source") || "").trim();
    if (!value) return;
    onCreate({
      paneId: name,
      title: name,
      surfaceKind: selected,
      source: sourceFrom(selected, value),
    });
  });
  dialog.append(form);
  return dialog;
}

function field(text: string, type: string, name: string, placeholder: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.textContent = text;
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.placeholder = placeholder;
  if (name === "title") input.value = "Untitled";
  label.append(input);
  return label;
}

function sourceFrom(kind: string, value: string): PaneSource {
  if (kind === "html") return { kind: "html", html: value };
  if (kind === "element" && !value.includes("/") && !value.endsWith(".ts") && !value.endsWith(".js")) {
    return { kind: "element", tag: value };
  }
  const framework =
    kind === "react" || kind === "vue" || kind === "svelte" || kind === "element" ? kind : "auto";
  return { kind: "module", url: value, framework };
}
