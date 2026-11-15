import type { GraphNode, GraphEdge } from "../knowledge/types.ts";

export interface SimNode {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  connectionCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  isPinned?: boolean;
  fx?: number;
  fy?: number;
}

export interface SimLink {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  description: string | null;
  sourceNode?: SimNode;
  targetNode?: SimNode;
}

export class GraphSimulation {
  public nodes: SimNode[] = [];
  public links: SimLink[] = [];
  public nodeMap: Map<string, SimNode> = new Map();
  public alpha: number = 1.0;
  public alphaMin: number = 0.003;
  public alphaDecay: number = 0.96;

  // Physical parameters
  public repulsionStrength: number = 2800;
  public springLength: number = 110;
  public springStrength: number = 0.055;
  public centerGravity: number = 0.035;

  constructor() {}

  public setData(rawNodes: GraphNode[], rawEdges: GraphEdge[], preservePositions = true) {
    const oldPositions = new Map<string, { x: number; y: number }>();
    if (preservePositions) {
      for (const n of this.nodes) {
        oldPositions.set(n.id, { x: n.x, y: n.y });
      }
    }

    this.nodeMap.clear();
    const count = rawNodes.length;

    // Arrange initial positions in celestial spiral / circular distribution
    this.nodes = rawNodes.map((n, i) => {
      const old = oldPositions.get(n.id);
      let initX = old ? old.x : 0;
      let initY = old ? old.y : 0;

      if (!old) {
        const angle = i * 2.39996; // Golden angle for even spatial distribution
        const dist = 35 + Math.sqrt(i + 1) * 65;
        initX = Math.cos(angle) * dist;
        initY = Math.sin(angle) * dist;
      }

      // Radius scales gently with connections: base 6px, max 16px
      const baseRadius = 7;
      const bonus = Math.min(n.connection_count * 1.5, 9);
      const radius = baseRadius + bonus;

      const simNode: SimNode = {
        id: n.id,
        title: n.title,
        preview: n.preview,
        tags: [...n.tags],
        connectionCount: n.connection_count,
        x: initX,
        y: initY,
        vx: 0,
        vy: 0,
        radius,
      };

      this.nodeMap.set(n.id, simNode);
      return simNode;
    });

    // Resolve edge endpoints
    this.links = rawEdges
      .filter((e) => this.nodeMap.has(e.source) && this.nodeMap.has(e.target))
      .map((e) => ({
        id: e.id,
        sourceId: e.source,
        targetId: e.target,
        relationType: e.relation_type,
        description: e.description,
        sourceNode: this.nodeMap.get(e.source),
        targetNode: this.nodeMap.get(e.target),
      }));

    this.alpha = count > 0 ? 1.0 : 0;
  }

  public isSettled(): boolean {
    return this.alpha < this.alphaMin;
  }

  public restart(alpha = 1.0) {
    this.alpha = this.nodes.length > 0 ? alpha : 0;
  }

  public reheat(alpha = 0.25) {
    if (this.nodes.length > 0 && this.alpha < alpha) {
      this.alpha = alpha;
    }
  }

  public tick(): boolean {
    if (this.nodes.length === 0) {
      this.alpha = 0;
      return false;
    }

    if (this.isSettled()) {
      return false;
    }

    const currentAlpha = this.alpha;
    const nodeCount = this.nodes.length;

    const isPinned = (n: SimNode) => n.isPinned === true || n.fx !== undefined;

    // 1. Repulsion force between all node pairs (Coulomb soft-core)
    for (let i = 0; i < nodeCount; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < nodeCount; j++) {
        const b = this.nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;

        // Prevent singularity at 0 distance
        if (distSq < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distSq = 1;
        }

        const dist = Math.sqrt(distSq);
        // Force inversely proportional to distance, bounded for stability
        const force = (this.repulsionStrength / (distSq + 400)) * currentAlpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!isPinned(a)) {
          a.vx -= fx;
          a.vy -= fy;
        }
        if (!isPinned(b)) {
          b.vx += fx;
          b.vy += fy;
        }

        // Collision separation
        const minDist = a.radius + b.radius + 12;
        if (dist < minDist) {
          const overlap = (minDist - dist) * 0.5 * currentAlpha;
          const ox = (dx / dist) * overlap;
          const oy = (dy / dist) * overlap;
          if (!isPinned(a)) {
            a.vx -= ox;
            a.vy -= oy;
          }
          if (!isPinned(b)) {
            b.vx += ox;
            b.vy += oy;
          }
        }
      }
    }

    // 2. Spring attraction along links (Hooke's Law)
    for (const link of this.links) {
      if (!link.sourceNode || !link.targetNode) continue;
      const s = link.sourceNode;
      const t = link.targetNode;

      let dx = t.x - s.x;
      let dy = t.y - s.y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) {
        dist = 1;
        dx = 1;
      }

      const displacement = dist - this.springLength;
      const force = displacement * this.springStrength * currentAlpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!isPinned(s)) {
        s.vx += fx;
        s.vy += fy;
      }
      if (!isPinned(t)) {
        t.vx -= fx;
        t.vy -= fy;
      }
    }

    // 3. Center gravity (pulls nodes and disconnected clusters towards 0, 0)
    for (const node of this.nodes) {
      if (!isPinned(node)) {
        node.vx -= node.x * this.centerGravity * currentAlpha;
        node.vy -= node.y * this.centerGravity * currentAlpha;
      }
    }

    // 4. Position update with velocity damping (friction)
    const damping = 0.82;
    for (const node of this.nodes) {
      if (isPinned(node)) {
        if (node.fx !== undefined) node.x = node.fx;
        if (node.fy !== undefined) node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
      } else {
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;
      }
    }

    // 5. Cool down
    this.alpha *= this.alphaDecay;
    return true;
  }

  public getBounds(padding = 80) {
    if (this.nodes.length === 0) {
      return { minX: -200, maxX: 200, minY: -200, maxY: 200, width: 400, height: 400 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of this.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding,
      width: Math.max(maxX - minX + padding * 2, 200),
      height: Math.max(maxY - minY + padding * 2, 200),
    };
  }
}
