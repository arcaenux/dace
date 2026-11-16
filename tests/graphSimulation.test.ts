import test from "node:test";
import assert from "node:assert/strict";
import { GraphSimulation } from "../src/graph/graphSimulation.ts";
import type { GraphNode, GraphEdge } from "../src/knowledge/types.ts";

test("1. GraphSimulation initializes correctly with empty data", () => {
  const sim = new GraphSimulation();
  assert.strictEqual(sim.nodes.length, 0);
  assert.strictEqual(sim.links.length, 0);
  assert.strictEqual(sim.isSettled(), false);

  sim.setData([], []);
  assert.strictEqual(sim.nodes.length, 0);
  assert.strictEqual(sim.links.length, 0);

  // Stepping an empty simulation should settle immediately
  const moved = sim.tick();
  assert.strictEqual(moved, false);
  assert.strictEqual(sim.isSettled(), true);
});

test("2. GraphSimulation distributes initial node positions in astronomical radius", () => {
  const nodes: GraphNode[] = [
    {
      id: "node-1",
      title: "First Concept",
      preview: "Preview 1",
      created_at: 1000,
      updated_at: 1000,
      connection_count: 1,
      tags: ["tagA"],
    },
    {
      id: "node-2",
      title: "Second Concept",
      preview: "Preview 2",
      created_at: 1001,
      updated_at: 1001,
      connection_count: 1,
      tags: ["tagB"],
    },
    {
      id: "node-3",
      title: "Isolated Concept",
      preview: "Preview 3",
      created_at: 1002,
      updated_at: 1002,
      connection_count: 0,
      tags: [],
    },
  ];

  const edges: GraphEdge[] = [
    {
      id: "edge-1",
      source: "node-1",
      target: "node-2",
      relation_type: "relates_to",
      created_at: 1005,
    },
  ];

  const sim = new GraphSimulation({ width: 800, height: 600 });
  sim.setData(nodes, edges, true);

  assert.strictEqual(sim.nodes.length, 3);
  assert.strictEqual(sim.links.length, 1);
  assert.strictEqual(sim.links[0].sourceNode?.id, "node-1");
  assert.strictEqual(sim.links[0].targetNode?.id, "node-2");

  // Verify all nodes have finite numeric initial coordinates
  for (const n of sim.nodes) {
    assert.strictEqual(Number.isFinite(n.x), true);
    assert.strictEqual(Number.isFinite(n.y), true);
    assert.strictEqual(Number.isFinite(n.radius), true);
    assert.ok(n.radius >= 7, "Node radius should be at least base size");
  }
});

test("3. GraphSimulation cools down monotonically and reaches 0% CPU settled state", () => {
  const nodes: GraphNode[] = [
    {
      id: "a",
      title: "Alpha",
      preview: "",
      created_at: 1,
      updated_at: 1,
      connection_count: 1,
      tags: [],
    },
    {
      id: "b",
      title: "Beta",
      preview: "",
      created_at: 2,
      updated_at: 2,
      connection_count: 1,
      tags: [],
    },
  ];
  const edges: GraphEdge[] = [
    {
      id: "e1",
      source: "a",
      target: "b",
      relation_type: "supports",
      created_at: 3,
    },
  ];

  const sim = new GraphSimulation();
  sim.setData(nodes, edges);
  sim.restart(1.0);

  assert.strictEqual(sim.isSettled(), false);
  assert.strictEqual(sim.alpha, 1.0);

  let previousAlpha = sim.alpha;
  let iterations = 0;
  const maxIterations = 500;

  // Step until simulation settles
  while (!sim.isSettled() && iterations < maxIterations) {
    const moved = sim.tick();
    iterations++;
    if (moved) {
      assert.ok(
        sim.alpha <= previousAlpha,
        `Alpha should monotonically decay: prev ${previousAlpha}, curr ${sim.alpha}`
      );
      previousAlpha = sim.alpha;
    }
  }

  assert.strictEqual(sim.isSettled(), true, "Simulation must settle within 500 ticks");
  assert.ok(iterations < 200, `Simulation cooled efficiently in ${iterations} iterations`);

  // Once settled, subsequent tick() calls must immediately return false without doing work
  const workDoneAfterSettled = sim.tick();
  assert.strictEqual(workDoneAfterSettled, false);
});

test("4. Spring attraction keeps linked nodes closer than unlinked nodes", () => {
  // Set up 3 nodes: A and B are linked; C is unlinked
  const nodes: GraphNode[] = [
    { id: "1", title: "1", preview: "", created_at: 1, updated_at: 1, connection_count: 1, tags: [] },
    { id: "2", title: "2", preview: "", created_at: 2, updated_at: 2, connection_count: 1, tags: [] },
    { id: "3", title: "3", preview: "", created_at: 3, updated_at: 3, connection_count: 0, tags: [] },
  ];
  const edges: GraphEdge[] = [
    { id: "e1", source: "1", target: "2", relation_type: "derives_from", created_at: 1 },
  ];

  const sim = new GraphSimulation({ linkDistance: 90 });
  sim.setData(nodes, edges, true);

  // Place 1 and 2 far apart initially
  const n1 = sim.nodes.find((n) => n.id === "1")!;
  const n2 = sim.nodes.find((n) => n.id === "2")!;
  n1.x = -300;
  n1.y = 0;
  n2.x = 300;
  n2.y = 0;

  sim.restart(1.0);
  for (let i = 0; i < 150; i++) {
    sim.tick();
  }

  const finalDist = Math.hypot(n1.x - n2.x, n1.y - n2.y);
  // Initial dist was 600; spring attraction should pull them towards linkDistance (~90-180)
  assert.ok(
    finalDist < 350,
    `Linked nodes should be pulled significantly closer. Final dist: ${finalDist}`
  );
});

test("5. Node position pinning during drag preserves user placement", () => {
  const nodes: GraphNode[] = [
    { id: "fixed", title: "Fixed", preview: "", created_at: 1, updated_at: 1, connection_count: 0, tags: [] },
  ];
  const sim = new GraphSimulation();
  sim.setData(nodes, []);

  const node = sim.nodes[0];
  // Pin node to fixed coordinates
  node.fx = 150;
  node.fy = -200;
  node.x = 150;
  node.y = -200;

  sim.restart(1.0);
  for (let i = 0; i < 30; i++) {
    sim.tick();
  }

  assert.strictEqual(node.x, 150, "Pinned node x should remain exactly at fx");
  assert.strictEqual(node.y, -200, "Pinned node y should remain exactly at fy");

  // Release pin
  delete node.fx;
  delete node.fy;
  sim.tick();
  // Node is now free to move under central gravity
  assert.strictEqual(node.fx, undefined);
  assert.strictEqual(node.fy, undefined);
});

test("6. Preserving existing positions when refreshing data", () => {
  const initialNodes: GraphNode[] = [
    { id: "preserved", title: "P", preview: "", created_at: 1, updated_at: 1, connection_count: 0, tags: [] },
  ];
  const sim = new GraphSimulation();
  sim.setData(initialNodes, []);
  sim.nodes[0].x = 42.5;
  sim.nodes[0].y = 99.1;

  // New incoming data with the same node and an added node
  const updatedNodes: GraphNode[] = [
    { id: "preserved", title: "P Updated", preview: "", created_at: 1, updated_at: 2, connection_count: 1, tags: [] },
    { id: "brand-new", title: "New", preview: "", created_at: 3, updated_at: 3, connection_count: 1, tags: [] },
  ];

  // setData with preservePositions = true (default)
  sim.setData(updatedNodes, [], true);

  const preservedNode = sim.nodes.find((n) => n.id === "preserved")!;
  assert.strictEqual(preservedNode.x, 42.5, "Existing node coordinates must be preserved");
  assert.strictEqual(preservedNode.y, 99.1, "Existing node coordinates must be preserved");

  const brandNewNode = sim.nodes.find((n) => n.id === "brand-new")!;
  assert.strictEqual(Number.isFinite(brandNewNode.x), true);
  assert.strictEqual(Number.isFinite(brandNewNode.y), true);
});
