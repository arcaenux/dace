import {
  FC,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  MouseEvent as ReactMouseEvent,
  WheelEvent as ReactWheelEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { KnowledgeGraphData } from "../knowledge/types";
import { getRelationMeta } from "../knowledge/relationshipConstants";
import * as api from "../knowledge/knowledgeApi";
import { GraphSimulation, SimNode, SimLink } from "./graphSimulation";

interface KnowledgeGraphViewProps {
  onOpenRecordInDesk: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
}

export const KnowledgeGraphView: FC<KnowledgeGraphViewProps> = ({
  onOpenRecordInDesk,
  onShowNotice,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Graph Data
  const [graphData, setGraphData] = useState<KnowledgeGraphData>({ nodes: [], edges: [] });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Camera Pan and Zoom
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1.0);

  // Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Simulation instance
  const simulationRef = useRef<GraphSimulation>(new GraphSimulation());
  const animFrameIdRef = useRef<number | null>(null);

  // Interaction refs for drag and pan
  const isDraggingCanvasRef = useRef<boolean>(false);
  const isDraggingNodeRef = useRef<boolean>(false);
  const dragStartMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStartPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggedNodeRef = useRef<SimNode | null>(null);

  // Load graph data from SQLite
  const loadGraph = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getKnowledgeGraph();
      setGraphData(data);
      simulationRef.current.setData(data.nodes, data.edges, true);
      simulationRef.current.restart(1.0);
    } catch (err) {
      console.error("[KnowledgeGraph] Failed to load graph data:", err);
      onShowNotice("Failed to load knowledge graph from database");
    } finally {
      setIsLoading(false);
    }
  }, [onShowNotice]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Compute 1-hop connected neighbors of selected node for highlight queries
  const neighborSet = useMemo(() => {
    const set = new Set<string>();
    if (!selectedNodeId) return set;
    set.add(selectedNodeId);

    for (const edge of graphData.edges) {
      if (edge.source === selectedNodeId) set.add(edge.target);
      if (edge.target === selectedNodeId) set.add(edge.source);
    }
    return set;
  }, [selectedNodeId, graphData.edges]);

  // Render loop using requestAnimationFrame
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-DPI resolution scaling
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    // Step physics simulation
    simulationRef.current.tick();

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Deep midnight astronomical background
    ctx.fillStyle = "#070a14";
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle radial atmospheric nebula gradient
    const centerX = width / 2;
    const centerY = height / 2;
    const nebulaGrad = ctx.createRadialGradient(
      centerX,
      centerY,
      50,
      centerX,
      centerY,
      Math.max(width, height) * 0.75
    );
    nebulaGrad.addColorStop(0, "rgba(14, 165, 233, 0.045)");
    nebulaGrad.addColorStop(0.5, "rgba(99, 102, 241, 0.025)");
    nebulaGrad.addColorStop(1, "rgba(7, 10, 20, 0)");
    ctx.fillStyle = nebulaGrad;
    ctx.fillRect(0, 0, width, height);

    // Apply Camera Transform
    ctx.translate(width / 2 + pan.x, height / 2 + pan.y);
    ctx.scale(zoom, zoom);

    const nodes = simulationRef.current.nodes;
    const links = simulationRef.current.links;
    const hasSelection = selectedNodeId !== null;

    // 3. Render Directed Relationship Edges
    for (const link of links) {
      if (!link.sourceNode || !link.targetNode) continue;
      const s = link.sourceNode;
      const t = link.targetNode;

      const isLinkSelected = selectedEdgeId === link.id;
      const isConnectedToSelected =
        selectedNodeId !== null &&
        (link.sourceId === selectedNodeId || link.targetId === selectedNodeId);

      let strokeStyle = "rgba(90, 140, 210, 0.22)";
      let lineWidth = 1.2;

      if (isLinkSelected) {
        strokeStyle = "rgba(56, 189, 248, 0.95)";
        lineWidth = 2.4;
      } else if (isConnectedToSelected) {
        strokeStyle = "rgba(56, 189, 248, 0.75)";
        lineWidth = 1.8;
      } else if (hasSelection) {
        strokeStyle = "rgba(60, 80, 110, 0.08)";
        lineWidth = 0.8;
      }

      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth / zoom;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();

      // Subtle Directional Arrow Marker pointing toward target
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 25) {
        // Place arrow at 62% along the line
        const arrowDist = dist * 0.62;
        const arrowX = s.x + (dx / dist) * arrowDist;
        const arrowY = s.y + (dy / dist) * arrowDist;
        const angle = Math.atan2(dy, dx);
        const arrowSize = Math.max(4.5 / zoom, 3.5);

        ctx.save();
        ctx.translate(arrowX, arrowY);
        ctx.rotate(angle);
        ctx.fillStyle = strokeStyle;
        ctx.beginPath();
        ctx.moveTo(arrowSize * 1.5, 0);
        ctx.lineTo(-arrowSize, -arrowSize * 0.8);
        ctx.lineTo(-arrowSize * 0.4, 0);
        ctx.lineTo(-arrowSize, arrowSize * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // If edge is highlighted or selected, render clean relationship type label along midpoint
      if (isLinkSelected || isConnectedToSelected) {
        const midX = (s.x + t.x) * 0.5;
        const midY = (s.y + t.y) * 0.5;
        const meta = getRelationMeta(link.relationType);
        const labelText = meta.label;

        ctx.save();
        ctx.font = `${Math.max(9 / zoom, 8)}px "Inter", system-ui, sans-serif`;
        const textMetrics = ctx.measureText(labelText);
        const padX = 6 / zoom;
        const pillW = textMetrics.width + padX * 2;
        const pillH = 14 / zoom;

        // Label Background Capsule
        ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
        ctx.strokeStyle = isLinkSelected ? "rgba(56, 189, 248, 0.8)" : "rgba(56, 189, 248, 0.4)";
        ctx.lineWidth = 1 / zoom;
        ctx.beginPath();
        ctx.roundRect(midX - pillW / 2, midY - pillH / 2, pillW, pillH, 4 / zoom);
        ctx.fill();
        ctx.stroke();

        // Label Text
        ctx.fillStyle = isLinkSelected ? "#38bdf8" : "#bae6fd";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, midX, midY);
        ctx.restore();
      }
    }

    // 4. Render Nodes
    for (const node of nodes) {
      const isSelected = selectedNodeId === node.id;
      const isNeighbor = neighborSet.has(node.id) && !isSelected;
      const isHovered = hoveredNodeId === node.id;
      const isDimmed = hasSelection && !isSelected && !isNeighbor;

      const r = node.radius;

      // Outer Radial Glow Aura
      ctx.save();
      const glowRadius = isSelected ? r * 3.4 : isNeighbor || isHovered ? r * 2.6 : r * 2.0;
      const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);

      if (isSelected) {
        glow.addColorStop(0, "rgba(56, 189, 248, 0.55)");
        glow.addColorStop(0.5, "rgba(56, 189, 248, 0.2)");
        glow.addColorStop(1, "rgba(56, 189, 248, 0)");
      } else if (isNeighbor || isHovered) {
        glow.addColorStop(0, "rgba(147, 197, 253, 0.4)");
        glow.addColorStop(0.6, "rgba(99, 102, 241, 0.15)");
        glow.addColorStop(1, "rgba(99, 102, 241, 0)");
      } else if (isDimmed) {
        glow.addColorStop(0, "rgba(60, 80, 110, 0.05)");
        glow.addColorStop(1, "rgba(60, 80, 110, 0)");
      } else {
        glow.addColorStop(0, "rgba(56, 189, 248, 0.22)");
        glow.addColorStop(0.7, "rgba(30, 58, 138, 0.08)");
        glow.addColorStop(1, "rgba(15, 23, 42, 0)");
      }

      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Core Node Circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

      if (isSelected) {
        ctx.fillStyle = "#0284c7";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.2 / zoom;
      } else if (isNeighbor) {
        ctx.fillStyle = "#0c234a";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.8 / zoom;
      } else if (isDimmed) {
        ctx.fillStyle = "#090d1a";
        ctx.strokeStyle = "rgba(71, 85, 105, 0.3)";
        ctx.lineWidth = 1 / zoom;
      } else {
        ctx.fillStyle = "#0c172e";
        ctx.strokeStyle = "rgba(125, 211, 252, 0.55)";
        ctx.lineWidth = 1.4 / zoom;
      }

      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Node Label
      const shouldDrawLabel =
        zoom > 0.65 || isSelected || isNeighbor || isHovered || node.connectionCount > 0;

      if (shouldDrawLabel) {
        ctx.save();
        const fontSize = Math.max(11 / zoom, 9);
        ctx.font = `${fontSize}px "Inter", system-ui, sans-serif`;
        const label = node.title || "Untitled Concept";
        const textMetrics = ctx.measureText(label);

        const labelY = node.y + r + 10 / zoom;
        const textW = textMetrics.width;
        const textH = fontSize * 1.2;

        // Subtle background pill for label readability
        ctx.fillStyle = "rgba(7, 10, 20, 0.72)";
        ctx.beginPath();
        ctx.roundRect(
          node.x - textW / 2 - 4 / zoom,
          labelY - textH / 2,
          textW + 8 / zoom,
          textH,
          3 / zoom
        );
        ctx.fill();

        // Text fill
        if (isSelected) {
          ctx.fillStyle = "#38bdf8";
        } else if (isNeighbor || isHovered) {
          ctx.fillStyle = "#e2e8f0";
        } else if (isDimmed) {
          ctx.fillStyle = "rgba(148, 163, 184, 0.3)";
        } else {
          ctx.fillStyle = "#cbd5e1";
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, node.x, labelY);
        ctx.restore();
      }
    }

    ctx.restore();

    // Continue animation frame if physics is still cooling down
    if (!simulationRef.current.isSettled()) {
      animFrameIdRef.current = requestAnimationFrame(render);
    }
  }, [pan, zoom, selectedNodeId, selectedEdgeId, hoveredNodeId, neighborSet]);

  // Trigger animation loop whenever state changes
  useEffect(() => {
    if (animFrameIdRef.current !== null) {
      cancelAnimationFrame(animFrameIdRef.current);
    }
    animFrameIdRef.current = requestAnimationFrame(render);
    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [render]);

  // Convert mouse screen coordinates to world coordinates
  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      return {
        x: (screenX - (width / 2 + pan.x)) / zoom,
        y: (screenY - (height / 2 + pan.y)) / zoom,
      };
    },
    [pan, zoom]
  );

  // Hit test for node
  const getNodeAt = useCallback(
    (worldX: number, worldY: number): SimNode | null => {
      const nodes = simulationRef.current.nodes;
      // Search in reverse order (top to bottom)
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = worldX - n.x;
        const dy = worldY - n.y;
        if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) {
          return n;
        }
      }
      return null;
    },
    []
  );

  // Hit test for edge
  const getEdgeAt = useCallback(
    (worldX: number, worldY: number): SimLink | null => {
      const links = simulationRef.current.links;
      for (const link of links) {
        if (!link.sourceNode || !link.targetNode) continue;
        const s = link.sourceNode;
        const t = link.targetNode;

        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) continue;

        // Projection of (worldX, worldY) onto segment
        const u = ((worldX - s.x) * dx + (worldY - s.y) * dy) / lenSq;
        if (u >= 0.05 && u <= 0.95) {
          const projX = s.x + u * dx;
          const projY = s.y + u * dy;
          const distSq = (worldX - projX) * (worldX - projX) + (worldY - projY) * (worldY - projY);
          if (distSq <= 49) {
            // within 7px of line
            return link;
          }
        }
      }
      return null;
    },
    []
  );

  // Mouse Handlers
  const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const world = screenToWorld(mouseX, mouseY);

    const hitNode = getNodeAt(world.x, world.y);
    if (hitNode) {
      // Node clicked / dragged
      isDraggingNodeRef.current = true;
      draggedNodeRef.current = hitNode;
      hitNode.isPinned = true;
      setSelectedNodeId(hitNode.id);
      setSelectedEdgeId(null);
      simulationRef.current.reheat(0.2);
      render();
      return;
    }

    const hitEdge = getEdgeAt(world.x, world.y);
    if (hitEdge) {
      setSelectedEdgeId(hitEdge.id);
      setSelectedNodeId(null);
      render();
      return;
    }

    // Canvas panning initiated
    isDraggingCanvasRef.current = true;
    dragStartMouseRef.current = { x: e.clientX, y: e.clientY };
    dragStartPanRef.current = { ...pan };
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    render();
  };

  const handleMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingNodeRef.current && draggedNodeRef.current) {
      const world = screenToWorld(mouseX, mouseY);
      draggedNodeRef.current.x = world.x;
      draggedNodeRef.current.y = world.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      simulationRef.current.reheat(0.15);
      render();
      return;
    }

    if (isDraggingCanvasRef.current) {
      const dx = e.clientX - dragStartMouseRef.current.x;
      const dy = e.clientY - dragStartMouseRef.current.y;
      setPan({
        x: dragStartPanRef.current.x + dx,
        y: dragStartPanRef.current.y + dy,
      });
      return;
    }

    // Hover inspection
    const world = screenToWorld(mouseX, mouseY);
    const hitNode = getNodeAt(world.x, world.y);
    const nextHover = hitNode ? hitNode.id : null;
    if (nextHover !== hoveredNodeId) {
      setHoveredNodeId(nextHover);
      render();
    }
  };

  const handleMouseUp = () => {
    if (isDraggingNodeRef.current && draggedNodeRef.current) {
      draggedNodeRef.current.isPinned = false;
      isDraggingNodeRef.current = false;
      draggedNodeRef.current = null;
      simulationRef.current.reheat(0.1);
    }
    isDraggingCanvasRef.current = false;
  };

  // Double-click node to open in Knowledge Desk immediately
  const handleDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hitNode = getNodeAt(world.x, world.y);
    if (hitNode) {
      onOpenRecordInDesk(hitNode.id);
    }
  };

  // Zooming via Wheel
  const handleWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.2), 3.5);

    // Zoom centered toward mouse pointer
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const worldX = (mouseX - (width / 2 + pan.x)) / zoom;
    const worldY = (mouseY - (height / 2 + pan.y)) / zoom;

    const nextPanX = mouseX - width / 2 - worldX * newZoom;
    const nextPanY = mouseY - height / 2 - worldY * newZoom;

    setZoom(newZoom);
    setPan({ x: nextPanX, y: nextPanY });
  };

  // Viewport Actions
  const handleZoomIn = () => {
    setZoom((z) => Math.min(z * 1.25, 3.5));
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(z * 0.8, 0.2));
  };

  const handleResetView = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    simulationRef.current.restart(0.4);
    render();
  };

  const handleFitToViewport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = simulationRef.current.getBounds(90);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    const scaleX = width / bounds.width;
    const scaleY = height / bounds.height;
    const fitZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.3), 1.6);

    const boundsCenterX = (bounds.minX + bounds.maxX) * 0.5;
    const boundsCenterY = (bounds.minY + bounds.maxY) * 0.5;

    setZoom(fitZoom);
    setPan({
      x: -boundsCenterX * fitZoom,
      y: -boundsCenterY * fitZoom,
    });
    render();
  };

  // Pan to center a specific node and highlight it
  const centerOnNode = (nodeId: string) => {
    const node = simulationRef.current.nodeMap.get(nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setPan({ x: -node.x * zoom, y: -node.y * zoom });
    simulationRef.current.reheat(0.2);
    render();
  };

  // Search filtering
  const matchingSearchNodes = useMemo(() => {
    const clean = searchQuery.trim().toLowerCase();
    if (!clean) return [];
    return graphData.nodes.filter(
      (n) =>
        n.title.toLowerCase().includes(clean) ||
        n.tags.some((t) => t.toLowerCase().includes(clean)) ||
        n.preview.toLowerCase().includes(clean)
    );
  }, [graphData.nodes, searchQuery]);

  // Contextual Node Data for Inspector
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, graphData.nodes]);

  const selectedNodeRelationships = useMemo(() => {
    if (!selectedNodeId) return { outgoing: [], incoming: [] };
    const outgoing = graphData.edges.filter((e) => e.source === selectedNodeId);
    const incoming = graphData.edges.filter((e) => e.target === selectedNodeId);
    return { outgoing, incoming };
  }, [selectedNodeId, graphData.edges]);

  // Contextual Edge Data for Inspector
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    return graphData.edges.find((e) => e.id === selectedEdgeId) || null;
  }, [selectedEdgeId, graphData.edges]);

  const selectedEdgeSource = useMemo(() => {
    if (!selectedEdge) return null;
    return graphData.nodes.find((n) => n.id === selectedEdge.source) || null;
  }, [selectedEdge, graphData.nodes]);

  const selectedEdgeTarget = useMemo(() => {
    if (!selectedEdge) return null;
    return graphData.nodes.find((n) => n.id === selectedEdge.target) || null;
  }, [selectedEdge, graphData.nodes]);

  // Create new concept directly from graph
  const handleCreateNewConcept = async () => {
    try {
      const created = await api.createRecord({
        title: "",
        content: "",
      });
      onShowNotice("Created new concept in database");
      await loadGraph();
      onOpenRecordInDesk(created.id);
    } catch (err) {
      console.error("[KnowledgeGraph] Failed to create record:", err);
      onShowNotice("Error creating concept in database");
    }
  };

  // Global key navigation in graph view
  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setIsSearchFocused(false);
      render();
    } else if (
      (e.key === "/" || (e.ctrlKey && e.key === "f")) &&
      document.activeElement !== searchInputRef.current
    ) {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className="knowledge-graph-container"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Knowledge Graph Workspace"
    >
      {/* 1. High-Performance Astronomical Canvas */}
      <canvas
        ref={canvasRef}
        className="knowledge-graph-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      />

      {/* 2. Floating Search Field (Astronomical Glass Bar) */}
      <div className="graph-floating-search-bar">
        <div className="graph-search-input-wrap">
          <span className="search-icon">✦</span>
          <input
            ref={searchInputRef}
            type="text"
            className="graph-search-input"
            placeholder="Search concepts in graph... (/)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery("")}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Live Search Results Dropdown */}
        {isSearchFocused && searchQuery.trim() && (
          <div className="graph-search-dropdown">
            {matchingSearchNodes.length === 0 ? (
              <div className="search-empty">No concepts matching “{searchQuery}”</div>
            ) : (
              matchingSearchNodes.map((n) => (
                <div
                  key={n.id}
                  className="search-result-item"
                  onClick={() => {
                    centerOnNode(n.id);
                    setIsSearchFocused(false);
                  }}
                >
                  <div className="result-title">{n.title || "Untitled Concept"}</div>
                  {n.preview && <div className="result-preview">{n.preview}</div>}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 3. Floating Contextual Action Header (Top Right) */}
      <div className="graph-top-actions">
        <button
          type="button"
          className="desk-btn primary"
          onClick={handleCreateNewConcept}
          title="Create a new concept in SQLite"
        >
          + New Concept
        </button>
      </div>

      {/* 4. Floating Viewport Navigation Controls (Bottom Left) */}
      <div className="graph-viewport-controls">
        <button
          type="button"
          className="graph-control-btn"
          onClick={handleZoomIn}
          title="Zoom in (+)"
        >
          +
        </button>
        <button
          type="button"
          className="graph-control-btn"
          onClick={handleZoomOut}
          title="Zoom out (-)"
        >
          −
        </button>
        <button
          type="button"
          className="graph-control-btn"
          onClick={handleFitToViewport}
          title="Fit graph to viewport"
        >
          [ ]
        </button>
        <button
          type="button"
          className="graph-control-btn"
          onClick={handleResetView}
          title="Reset camera view"
        >
          ↺
        </button>
      </div>

      {/* 5. Contextual Inspector Pill / Modal for Selected Node */}
      {selectedNode && (
        <div className="graph-contextual-card" role="region" aria-label="Concept Inspector">
          <div className="card-top">
            <span className="card-badge">Concept</span>
            <button
              type="button"
              className="card-close-btn"
              onClick={() => setSelectedNodeId(null)}
              title="Deselect (Esc)"
            >
              ×
            </button>
          </div>

          <h3 className="card-title">{selectedNode.title || "Untitled Concept"}</h3>
          {selectedNode.preview && <p className="card-preview">{selectedNode.preview}</p>}

          {/* Connected concepts summary */}
          <div className="card-connections-info">
            <div className="connections-heading">
              Connected Concepts ({selectedNode.connection_count}):
            </div>
            {selectedNode.connection_count === 0 ? (
              <div className="connections-empty">This concept is currently isolated.</div>
            ) : (
              <div className="connected-chips-list">
                {selectedNodeRelationships.outgoing.map((e) => {
                  const target = graphData.nodes.find((n) => n.id === e.target);
                  const meta = getRelationMeta(e.relation_type);
                  return (
                    <span
                      key={e.id}
                      className="connected-chip outgoing"
                      onClick={() => centerOnNode(e.target)}
                      title={`Go to ${target?.title || "Concept"} (${meta.label})`}
                    >
                      <span className="chip-type">{meta.outgoingLabel}:</span>{" "}
                      {target?.title || "Untitled"}
                    </span>
                  );
                })}
                {selectedNodeRelationships.incoming.map((e) => {
                  const source = graphData.nodes.find((n) => n.id === e.source);
                  const meta = getRelationMeta(e.relation_type);
                  return (
                    <span
                      key={e.id}
                      className="connected-chip incoming"
                      onClick={() => centerOnNode(e.source)}
                      title={`Go to ${source?.title || "Concept"} (${meta.incomingLabel})`}
                    >
                      <span className="chip-type">{meta.incomingLabel}:</span>{" "}
                      {source?.title || "Untitled"}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action to navigate into full editor */}
          <div className="card-actions">
            <button
              type="button"
              className="desk-btn primary"
              onClick={() => onOpenRecordInDesk(selectedNode.id)}
            >
              Open Concept in Desk →
            </button>
          </div>
        </div>
      )}

      {/* 6. Contextual Inspector Pill for Selected Edge */}
      {selectedEdge && (
        <div className="graph-contextual-card" role="region" aria-label="Relationship Inspector">
          <div className="card-top">
            <span className="card-badge">Relationship</span>
            <button
              type="button"
              className="card-close-btn"
              onClick={() => setSelectedEdgeId(null)}
              title="Deselect (Esc)"
            >
              ×
            </button>
          </div>

          <div className="edge-connection-flow">
            <button
              type="button"
              className="edge-node-btn"
              onClick={() => centerOnNode(selectedEdge.source)}
            >
              {selectedEdgeSource?.title || "Source"}
            </button>
            <span className="edge-rel-badge">
              {getRelationMeta(selectedEdge.relation_type).label} →
            </span>
            <button
              type="button"
              className="edge-node-btn"
              onClick={() => centerOnNode(selectedEdge.target)}
            >
              {selectedEdgeTarget?.title || "Target"}
            </button>
          </div>

          {selectedEdge.description && (
            <p className="edge-desc-text">“{selectedEdge.description}”</p>
          )}

          <div className="card-actions">
            <button
              type="button"
              className="desk-btn"
              onClick={() => onOpenRecordInDesk(selectedEdge.source)}
            >
              Open Source
            </button>
            <button
              type="button"
              className="desk-btn"
              onClick={() => onOpenRecordInDesk(selectedEdge.target)}
            >
              Open Target
            </button>
          </div>
        </div>
      )}

      {/* 7. Empty Database Guidance */}
      {!isLoading && graphData.nodes.length === 0 && (
        <div className="graph-empty-overlay">
          <div className="graph-empty-card">
            <div className="empty-constellation-icon">✧</div>
            <h2 className="empty-heading">Knowledge Cosmos Empty</h2>
            <p className="empty-sub">
              Your knowledge graph will form an interconnected universe as you create concepts and
              link them together.
            </p>
            <button
              type="button"
              className="desk-btn primary"
              onClick={handleCreateNewConcept}
            >
              + Create First Concept
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
