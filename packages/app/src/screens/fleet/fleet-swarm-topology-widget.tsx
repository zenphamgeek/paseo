import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Maximize2, Minimize2, Move, RefreshCw, Sparkles, Zap } from "lucide-react-native";
import type { FleetNodeSummary } from "./types";

interface TopologyNode {
  id: string;
  label: string;
  sub: string;
  tier: "ultra" | "pro" | "free" | "hub" | "gateway";
  status: "idle" | "busy" | "error" | "unauth";
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  r: number;
  isDragging: boolean;
  quotaGemini?: number;
  quotaClaude?: number;
  requestsCount?: number;
}

interface Particle {
  x: number;
  y: number;
  t: number; // 0 to 1 progress
  speed: number;
  fromNode: string;
  toNode: string;
  color: string;
  size: number;
}

interface FleetSwarmTopologyWidgetProps {
  nodes?: FleetNodeSummary[];
  onNodeSelect?: (nodeId: string) => void;
}

const DEFAULT_NODES: TopologyNode[] = [
  // Special: Central Hub & Agent
  {
    id: "agent-session",
    label: "AGENT",
    sub: "SESSION",
    tier: "gateway",
    status: "busy",
    x: 80,
    y: 200,
    vx: 0,
    vy: 0,
    targetX: 80,
    targetY: 200,
    r: 26,
    isDragging: false,
  },
  {
    id: "swarm-hub",
    label: "ZENCODE",
    sub: "SWARM HUB",
    tier: "hub",
    status: "busy",
    x: 210,
    y: 200,
    vx: 0,
    vy: 0,
    targetX: 210,
    targetY: 200,
    r: 34,
    isDragging: false,
  },

  // ── 1. AGY Ultra Tier (Top Arc - Amber/Gold) ──
  {
    id: "nebula",
    label: "nebula",
    sub: "B.AI Opus 4.8",
    tier: "ultra",
    status: "idle",
    x: 350,
    y: 70,
    vx: 0,
    vy: 0,
    targetX: 350,
    targetY: 70,
    r: 25,
    isDragging: false,
    quotaClaude: 99,
  },
  {
    id: "pro-1",
    label: "innoria.team",
    sub: "Architect",
    tier: "ultra",
    status: "idle",
    x: 460,
    y: 55,
    vx: 0,
    vy: 0,
    targetX: 460,
    targetY: 55,
    r: 25,
    isDragging: false,
    quotaGemini: 88,
    quotaClaude: 92,
  },
  {
    id: "ultra-2",
    label: "lthn.Ariana",
    sub: "Judge",
    tier: "ultra",
    status: "idle",
    x: 570,
    y: 70,
    vx: 0,
    vy: 0,
    targetX: 570,
    targetY: 70,
    r: 24,
    isDragging: false,
    quotaGemini: 85,
    quotaClaude: 90,
  },

  // ── 2. AGY Pro Tier (Middle Arc - Cyan/Teal, 12 Nodes) ──
  {
    id: "ai-digimate",
    label: "digimate",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 300,
    y: 150,
    vx: 0,
    vy: 0,
    targetX: 300,
    targetY: 150,
    r: 20,
    isDragging: false,
    quotaGemini: 91,
  },
  {
    id: "binhthuong",
    label: "binhthuong",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 380,
    y: 140,
    vx: 0,
    vy: 0,
    targetX: 380,
    targetY: 140,
    r: 20,
    isDragging: false,
    quotaGemini: 82,
  },
  {
    id: "insilos",
    label: "insilos",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 460,
    y: 130,
    vx: 0,
    vy: 0,
    targetX: 460,
    targetY: 130,
    r: 20,
    isDragging: false,
    quotaGemini: 87,
  },
  {
    id: "node-4",
    label: "node-4",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 540,
    y: 140,
    vx: 0,
    vy: 0,
    targetX: 540,
    targetY: 140,
    r: 20,
    isDragging: false,
    quotaGemini: 94,
  },
  {
    id: "node-5",
    label: "node-5",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 620,
    y: 150,
    vx: 0,
    vy: 0,
    targetX: 620,
    targetY: 150,
    r: 20,
    isDragging: false,
    quotaGemini: 79,
  },
  {
    id: "codegeekvn",
    label: "codegeek",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 320,
    y: 210,
    vx: 0,
    vy: 0,
    targetX: 320,
    targetY: 210,
    r: 20,
    isDragging: false,
    quotaGemini: 90,
  },
  {
    id: "node-6",
    label: "node-6",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 400,
    y: 200,
    vx: 0,
    vy: 0,
    targetX: 400,
    targetY: 200,
    r: 20,
    isDragging: false,
    quotaGemini: 96,
  },
  {
    id: "team-3",
    label: "coderedgen",
    sub: "Guardian",
    tier: "pro",
    status: "idle",
    x: 480,
    y: 195,
    vx: 0,
    vy: 0,
    targetX: 480,
    targetY: 195,
    r: 20,
    isDragging: false,
    quotaGemini: 84,
  },
  {
    id: "sunward",
    label: "sunward",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 560,
    y: 200,
    vx: 0,
    vy: 0,
    targetX: 560,
    targetY: 200,
    r: 20,
    isDragging: false,
    quotaGemini: 92,
  },
  {
    id: "gaopham",
    label: "gaopham",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 640,
    y: 210,
    vx: 0,
    vy: 0,
    targetX: 640,
    targetY: 210,
    r: 20,
    isDragging: false,
    quotaGemini: 86,
  },
  {
    id: "justaskgao",
    label: "justaskgao",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 360,
    y: 260,
    vx: 0,
    vy: 0,
    targetX: 360,
    targetY: 260,
    r: 20,
    isDragging: false,
    quotaGemini: 89,
  },
  {
    id: "zenonmind",
    label: "zenonmind",
    sub: "Pro Node",
    tier: "pro",
    status: "idle",
    x: 600,
    y: 260,
    vx: 0,
    vy: 0,
    targetX: 600,
    targetY: 260,
    r: 20,
    isDragging: false,
    quotaGemini: 95,
  },

  // ── 3. OpenCode Free Swarm Tier (Lower Arc - Emerald #34d399, 14 Nodes) ──
  {
    id: "oc_ai-digimate",
    label: "oc_digimate",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 280,
    y: 330,
    vx: 0,
    vy: 0,
    targetX: 280,
    targetY: 330,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_binhthuong",
    label: "oc_binhthuong",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 340,
    y: 340,
    vx: 0,
    vy: 0,
    targetX: 340,
    targetY: 340,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_codegeekvn",
    label: "oc_codegeek",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 400,
    y: 350,
    vx: 0,
    vy: 0,
    targetX: 400,
    targetY: 350,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_gaopham",
    label: "oc_gaopham",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 460,
    y: 355,
    vx: 0,
    vy: 0,
    targetX: 460,
    targetY: 355,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_insilos",
    label: "oc_insilos",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 520,
    y: 355,
    vx: 0,
    vy: 0,
    targetX: 520,
    targetY: 355,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_justaskgao",
    label: "oc_justask",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 580,
    y: 350,
    vx: 0,
    vy: 0,
    targetX: 580,
    targetY: 350,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_node-4",
    label: "oc_node-4",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 640,
    y: 340,
    vx: 0,
    vy: 0,
    targetX: 640,
    targetY: 340,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_node-5",
    label: "oc_node-5",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 700,
    y: 330,
    vx: 0,
    vy: 0,
    targetX: 700,
    targetY: 330,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_node-6",
    label: "oc_node-6",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 320,
    y: 400,
    vx: 0,
    vy: 0,
    targetX: 320,
    targetY: 400,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_pro-1",
    label: "oc_innoria",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 390,
    y: 410,
    vx: 0,
    vy: 0,
    targetX: 390,
    targetY: 410,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_sunward",
    label: "oc_sunward",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 460,
    y: 415,
    vx: 0,
    vy: 0,
    targetX: 460,
    targetY: 415,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_team-3",
    label: "oc_codered",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 530,
    y: 415,
    vx: 0,
    vy: 0,
    targetX: 530,
    targetY: 415,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_ultra-2",
    label: "oc_ariana",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 600,
    y: 410,
    vx: 0,
    vy: 0,
    targetX: 600,
    targetY: 410,
    r: 18,
    isDragging: false,
  },
  {
    id: "oc_zenonmind",
    label: "oc_zenon",
    sub: "Free Quota",
    tier: "free",
    status: "idle",
    x: 670,
    y: 400,
    vx: 0,
    vy: 0,
    targetX: 670,
    targetY: 400,
    r: 18,
    isDragging: false,
  },

  // ── 4. Egress Gateways (Right Arc) ──
  {
    id: "egress-bai",
    label: "B.AI DIRECT",
    sub: "api.b.ai/v1",
    tier: "gateway",
    status: "idle",
    x: 820,
    y: 70,
    vx: 0,
    vy: 0,
    targetX: 820,
    targetY: 70,
    r: 28,
    isDragging: false,
  },
  {
    id: "egress-google",
    label: "ANTIGRAVITY",
    sub: "GOOGLE MESH",
    tier: "gateway",
    status: "idle",
    x: 830,
    y: 175,
    vx: 0,
    vy: 0,
    targetX: 830,
    targetY: 175,
    r: 28,
    isDragging: false,
  },
  {
    id: "egress-opencode",
    label: "OPENCODE",
    sub: "FREE SERVER",
    tier: "gateway",
    status: "idle",
    x: 820,
    y: 285,
    vx: 0,
    vy: 0,
    targetX: 820,
    targetY: 285,
    r: 28,
    isDragging: false,
  },
  {
    id: "egress-9router",
    label: "9ROUTER",
    sub: "LOCAL GATEWAY",
    tier: "gateway",
    status: "idle",
    x: 810,
    y: 395,
    vx: 0,
    vy: 0,
    targetX: 810,
    targetY: 395,
    r: 28,
    isDragging: false,
  },
];

export function FleetSwarmTopologyWidget({
  nodes: _nodes,
  onNodeSelect,
}: FleetSwarmTopologyWidgetProps) {
  const containerRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [pulseCount, setPulseCount] = useState(0);

  // Mutable internal state for 60fps canvas loop
  const stateRef = useRef<{
    nodes: TopologyNode[];
    particles: Particle[];
    draggedNodeId: string | null;
    dragOffsetX: number;
    dragOffsetY: number;
    tick: number;
    width: number;
    height: number;
    animId: number;
  }>({
    nodes: JSON.parse(JSON.stringify(DEFAULT_NODES)),
    particles: [],
    draggedNodeId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    tick: 0,
    width: 900,
    height: 480,
    animId: 0,
  });

  const triggerBurst = useCallback(() => {
    setPulseCount((c) => c + 1);
    const s = stateRef.current;
    const hub = s.nodes.find((n) => n.id === "swarm-hub");
    if (!hub) return;

    // Emit wave of particles from Hub to worker nodes
    s.nodes.forEach((node) => {
      if (node.id === "swarm-hub" || node.id === "agent-session") return;
      for (let i = 0; i < 3; i++) {
        s.particles.push({
          x: hub.x,
          y: hub.y,
          t: -i * 0.15,
          speed: 0.015 + Math.random() * 0.008,
          fromNode: "swarm-hub",
          toNode: node.id,
          color: node.tier === "ultra" ? "#fbbf24" : node.tier === "pro" ? "#38bdf8" : "#34d399",
          size: node.tier === "ultra" ? 3.5 : 2.5,
        });
      }
    });
  }, []);

  const resetLayout = useCallback(() => {
    const s = stateRef.current;
    s.nodes.forEach((node) => {
      const def = DEFAULT_NODES.find((d) => d.id === node.id);
      if (def) {
        node.targetX = def.targetX;
        node.targetY = def.targetY;
        node.vx = (def.targetX - node.x) * 0.2;
        node.vy = (def.targetY - node.y) * 0.2;
      }
    });
    setSelectedNode(null);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;

    // Handle high DPI scaling
    const updateSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth || 900;
      const h = isExpanded ? 640 : 480;
      const dpr = window.devicePixelRatio || 1;

      s.width = w;
      s.height = h;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    updateSize();

    // Spawn periodic ambient particles
    const particleInterval = setInterval(() => {
      const hub = s.nodes.find((n) => n.id === "swarm-hub");
      if (!hub) return;
      const workers = s.nodes.filter(
        (n) => n.id !== "swarm-hub" && n.id !== "agent-session" && !n.id.startsWith("egress"),
      );
      if (workers.length === 0) return;
      const target = workers[Math.floor(Math.random() * workers.length)];

      s.particles.push({
        x: hub.x,
        y: hub.y,
        t: 0,
        speed: 0.012 + Math.random() * 0.008,
        fromNode: "swarm-hub",
        toNode: target.id,
        color: target.tier === "ultra" ? "#fbbf24" : target.tier === "pro" ? "#38bdf8" : "#34d399",
        size: target.tier === "ultra" ? 3 : 2,
      });

      // Also spawn egress pulses
      let egressTarget = "egress-google";
      let pulseColor = "#38bdf8";

      if (target.id === "nebula") {
        egressTarget = "egress-bai";
        pulseColor = "#fbbf24";
      } else if (target.id.startsWith("oc_")) {
        egressTarget = Math.random() > 0.35 ? "egress-opencode" : "egress-9router";
        pulseColor = egressTarget === "egress-opencode" ? "#34d399" : "#a855f7";
      } else if (target.tier === "ultra") {
        egressTarget = "egress-google";
        pulseColor = "#fbbf24";
      }

      const egressNode = s.nodes.find((n) => n.id === egressTarget);
      if (egressNode) {
        s.particles.push({
          x: target.x,
          y: target.y,
          t: 0,
          speed: 0.015,
          fromNode: target.id,
          toNode: egressNode.id,
          color: pulseColor,
          size: 2.5,
        });
      }

      // Limit particle array size
      if (s.particles.length > 80) {
        s.particles.splice(0, s.particles.length - 80);
      }
    }, 140);

    // Mouse / Touch Event Handlers
    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const onMouseDown = (e: any) => {
      const pos = getPos(e);
      // Find clicked node
      for (let i = s.nodes.length - 1; i >= 0; i--) {
        const n = s.nodes[i];
        const dx = pos.x - n.x;
        const dy = pos.y - n.y;
        if (Math.sqrt(dx * dx + dy * dy) <= n.r + 5) {
          s.draggedNodeId = n.id;
          s.dragOffsetX = dx;
          s.dragOffsetY = dy;
          n.isDragging = true;
          setSelectedNode(n);
          onNodeSelect?.(n.id);
          break;
        }
      }
    };

    const onMouseMove = (e: any) => {
      if (!s.draggedNodeId) return;
      const pos = getPos(e);
      const n = s.nodes.find((node) => node.id === s.draggedNodeId);
      if (n) {
        n.x = pos.x - s.dragOffsetX;
        n.y = pos.y - s.dragOffsetY;
        n.targetX = n.x;
        n.targetY = n.y;
      }
    };

    const onMouseUp = () => {
      if (s.draggedNodeId) {
        const n = s.nodes.find((node) => node.id === s.draggedNodeId);
        if (n) n.isDragging = false;
        s.draggedNodeId = null;
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    canvas.addEventListener("touchstart", onMouseDown, { passive: true });
    window.addEventListener("touchmove", onMouseMove, { passive: true });
    window.addEventListener("touchend", onMouseUp);

    // 60FPS Render Loop
    const loop = () => {
      s.tick++;
      const W = s.width;
      const H = s.height;

      ctx.clearRect(0, 0, W, H);

      // 1. Draw subtle futuristic grid
      ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < W; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // 2. Physics step: Soft spring to target + collision repulsion
      const kSpring = 0.08;
      const damping = 0.85;
      s.nodes.forEach((n) => {
        if (!n.isDragging) {
          const fx = (n.targetX - n.x) * kSpring;
          const fy = (n.targetY - n.y) * kSpring;
          n.vx = (n.vx + fx) * damping;
          n.vy = (n.vy + fy) * damping;
          n.x += n.vx;
          n.y += n.vy;
        }
      });

      // Collision repulsion between nodes
      for (let i = 0; i < s.nodes.length; i++) {
        for (let j = i + 1; j < s.nodes.length; j++) {
          const n1 = s.nodes[i];
          const n2 = s.nodes[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = n1.r + n2.r + 14;
          if (dist < minDist) {
            const overlap = minDist - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            if (!n1.isDragging) {
              n1.x += nx * overlap * 0.3;
              n1.y += ny * overlap * 0.3;
            }
            if (!n2.isDragging) {
              n2.x -= nx * overlap * 0.3;
              n2.y -= ny * overlap * 0.3;
            }
          }
        }
      }

      // 3. Draw Connecting Bezier Edges
      const hub = s.nodes.find((n) => n.id === "swarm-hub");
      const agent = s.nodes.find((n) => n.id === "agent-session");
      const egressBai = s.nodes.find((n) => n.id === "egress-bai");
      const egressGoogle = s.nodes.find((n) => n.id === "egress-google");
      const egressOpenCode = s.nodes.find((n) => n.id === "egress-opencode");
      const egress9Router = s.nodes.find((n) => n.id === "egress-9router");

      // Agent -> Hub edge
      if (agent && hub) {
        drawBezierEdge(ctx, agent.x, agent.y, hub.x, hub.y, "#a855f7", 0.7, true, s.tick);
      }

      // Hub -> Worker nodes edges
      s.nodes.forEach((n) => {
        if (n.id === "swarm-hub" || n.id === "agent-session" || n.id.startsWith("egress")) {
          return;
        }
        if (hub) {
          const edgeCol = n.tier === "ultra" ? "#fbbf24" : n.tier === "pro" ? "#38bdf8" : "#34d399";
          const isBusy = n.status === "busy";
          drawBezierEdge(ctx, hub.x, hub.y, n.x, n.y, edgeCol, isBusy ? 0.7 : 0.4, isBusy, s.tick);
        }

        // Worker node -> Egress edges
        if (n.id === "nebula" && egressBai) {
          // Nebula connects directly to B.AI
          drawBezierEdge(ctx, n.x, n.y, egressBai.x, egressBai.y, "#fbbf24", 0.45, true, s.tick);
        } else if (n.tier === "ultra" && egressGoogle) {
          drawBezierEdge(
            ctx,
            n.x,
            n.y,
            egressGoogle.x,
            egressGoogle.y,
            "#fbbf24",
            0.3,
            false,
            s.tick,
          );
        } else if (n.tier === "pro" && egressGoogle) {
          drawBezierEdge(
            ctx,
            n.x,
            n.y,
            egressGoogle.x,
            egressGoogle.y,
            "#38bdf8",
            0.25,
            false,
            s.tick,
          );
        } else if (n.id.startsWith("oc_")) {
          // OpenCode nodes connect to OpenCode Server (primary) and 9Router (secondary)
          if (egressOpenCode) {
            drawBezierEdge(
              ctx,
              n.x,
              n.y,
              egressOpenCode.x,
              egressOpenCode.y,
              "#34d399",
              0.3,
              false,
              s.tick,
            );
          }
          if (egress9Router) {
            drawBezierEdge(
              ctx,
              n.x,
              n.y,
              egress9Router.x,
              egress9Router.y,
              "#a78bfa",
              0.15,
              false,
              s.tick,
            );
          }
        } else if (egress9Router) {
          drawBezierEdge(
            ctx,
            n.x,
            n.y,
            egress9Router.x,
            egress9Router.y,
            "#a78bfa",
            0.25,
            false,
            s.tick,
          );
        }
      });

      // 4. Update & Render Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.t += p.speed;
        if (p.t > 1) {
          s.particles.splice(i, 1);
          continue;
        }
        if (p.t < 0) continue;

        const from = s.nodes.find((n) => n.id === p.fromNode);
        const to = s.nodes.find((n) => n.id === p.toNode);
        if (from && to) {
          const mx = (from.x + to.x) / 2;
          const pos = getCubicBezierPoint(from.x, from.y, mx, from.y, mx, to.y, to.x, to.y, p.t);

          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.restore();
        }
      }

      // 5. Render All Nodes
      s.nodes.forEach((n) => {
        drawNode(ctx, n, s.tick, selectedNode?.id === n.id);
      });

      s.animId = requestAnimationFrame(loop);
    };

    s.animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(s.animId);
      clearInterval(particleInterval);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onMouseDown);
      window.removeEventListener("touchmove", onMouseMove);
      window.removeEventListener("touchend", onMouseUp);
    };
  }, [isExpanded, selectedNode, onNodeSelect]);

  const CanvasTag = "canvas" as unknown as React.ElementType;

  return (
    <View style={styles.card} ref={containerRef}>
      {/* Widget Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconBox}>
            <Zap size={16} color="#38bdf8" />
          </View>
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Autonomous Swarm Live Topology</Text>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>60 FPS MESH</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>
              Core Hub ⇄ Fleet Swarm (AGY Ultra/Pro + OpenCode Free) ⇄ Egress Gateways
            </Text>
          </View>
        </View>

        <View style={styles.headerControls}>
          <Pressable onPress={triggerBurst} style={styles.btnAction} testID="btn-swarm-burst">
            <Sparkles size={12} color="#fbbf24" />
            <Text style={styles.btnActionText}>Burst Pulse</Text>
          </Pressable>

          <Pressable onPress={resetLayout} style={styles.btnAction} testID="btn-reset-layout">
            <RefreshCw size={12} color="#94a3b8" />
            <Text style={styles.btnActionText}>Reset</Text>
          </Pressable>

          <Pressable
            onPress={() => setIsExpanded((v) => !v)}
            style={styles.btnAction}
            testID="btn-expand-topology"
          >
            {isExpanded ? (
              <Minimize2 size={12} color="#94a3b8" />
            ) : (
              <Maximize2 size={12} color="#94a3b8" />
            )}
            <Text style={styles.btnActionText}>{isExpanded ? "Collapse" : "Expand"}</Text>
          </Pressable>
        </View>
      </View>

      {/* Canvas Wrap */}
      <View style={[styles.canvasWrap, isExpanded && styles.canvasWrapExpanded]}>
        <CanvasTag
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: "grab",
          }}
        />

        {/* Floating Hint Overlay */}
        <View style={styles.floatingHint}>
          <Move size={11} color="#64748b" />
          <Text style={styles.hintText}>Drag nodes to explore spring physics</Text>
        </View>

        {/* Legend */}
        <View style={styles.legendBar}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: "#fbbf24" }]} />
            <Text style={styles.legendLabel}>Ultra (Opus)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: "#38bdf8" }]} />
            <Text style={styles.legendLabel}>Pro (Gemini)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: "#34d399" }]} />
            <Text style={styles.legendLabel}>OpenCode Free</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: "#a855f7" }]} />
            <Text style={styles.legendLabel}>Hub / Agent</Text>
          </View>
        </View>

        {/* Active Node Inspector Drawer */}
        {selectedNode ? (
          <View style={styles.nodeInspector}>
            <View style={styles.inspectorHeader}>
              <Text style={styles.inspectorTitle}>{selectedNode.label}</Text>
              <Text style={styles.inspectorTier}>{selectedNode.tier.toUpperCase()}</Text>
            </View>
            <Text style={styles.inspectorSub}>{selectedNode.sub}</Text>
            <View style={styles.inspectorDivider} />
            <View style={styles.inspectorRow}>
              <Text style={styles.inspectorKey}>Status</Text>
              <Text style={styles.inspectorVal}>{selectedNode.status.toUpperCase()}</Text>
            </View>
            {selectedNode.quotaGemini !== undefined ? (
              <View style={styles.inspectorRow}>
                <Text style={styles.inspectorKey}>Gemini Quota</Text>
                <Text style={styles.inspectorVal}>{selectedNode.quotaGemini}%</Text>
              </View>
            ) : null}
            {selectedNode.quotaClaude !== undefined ? (
              <View style={styles.inspectorRow}>
                <Text style={styles.inspectorKey}>Claude Quota</Text>
                <Text style={styles.inspectorVal}>{selectedNode.quotaClaude}%</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ── CANVAS DRAWING HELPERS ──

function drawBezierEdge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  opacity: number,
  animated: boolean,
  tick: number,
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = animated ? 1.6 : 1.0;

  if (animated) {
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -((tick * 0.75) % 20);
  } else {
    ctx.setLineDash([4, 4]);
  }

  const mx = (x1 + x2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
  ctx.stroke();
  ctx.restore();
}

function getCubicBezierPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  const x = uuu * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + ttt * x3;
  const y = uuu * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + ttt * y3;
  return { x, y };
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: TopologyNode,
  tick: number,
  isSelected: boolean,
) {
  const { x, y, r, tier, label, sub, status } = node;

  ctx.save();

  // Tier Colors
  let primaryCol = "#38bdf8"; // pro
  if (tier === "ultra") primaryCol = "#fbbf24";
  else if (tier === "free") primaryCol = "#34d399";
  else if (tier === "hub") primaryCol = "#0284c7";
  else if (tier === "gateway") {
    if (node.id === "egress-bai") primaryCol = "#fbbf24";
    else if (node.id === "egress-google") primaryCol = "#38bdf8";
    else if (node.id === "egress-opencode") primaryCol = "#34d399";
    else primaryCol = "#a855f7";
  }

  // 1. Radial Glow
  const glowRadius = r * 1.8;
  const grad = ctx.createRadialGradient(x, y, r * 0.2, x, y, glowRadius);
  grad.addColorStop(0, primaryCol + "33");
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // 2. Pulse Ring for Active / Ultra Nodes
  if (status === "busy" || tier === "ultra" || isSelected) {
    const pulseR = r + 4 + Math.sin(tick * 0.08) * 3;
    ctx.strokeStyle = primaryCol + (isSelected ? "cc" : "66");
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(x, y, pulseR, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. Node Body (Rounded rect or Circle)
  ctx.fillStyle = "#090d16";
  ctx.strokeStyle = isSelected ? "#ffffff" : primaryCol;
  ctx.lineWidth = isSelected ? 2.5 : 1.8;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 4. Inner Tint Fill
  ctx.fillStyle = primaryCol + "1f";
  ctx.beginPath();
  ctx.arc(x, y, r - 2, 0, Math.PI * 2);
  ctx.fill();

  // 5. Status Indicator Dot (top right)
  const dotX = x + r * 0.65;
  const dotY = y - r * 0.65;
  ctx.fillStyle = status === "busy" ? "#fbbf24" : status === "error" ? "#f43f5e" : "#10b981";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#090d16";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 6. Typography
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#f8fafc";
  ctx.font = `bold ${r >= 26 ? 10 : 8}px Inter, sans-serif`;
  ctx.fillText(label, x, y - (sub ? 4 : 0));

  if (sub) {
    ctx.fillStyle = primaryCol;
    ctx.font = `600 ${r >= 26 ? 8 : 7}px monospace`;
    ctx.fillText(sub, x, y + 7);
  }

  // 7. Mini Quota Indicator Arc / Bar
  if (node.quotaGemini !== undefined) {
    const barW = r * 1.4;
    const barH = 2.5;
    const barX = x - barW / 2;
    const barY = y + r + 4;

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = primaryCol;
    ctx.fillRect(barX, barY, (barW * node.quotaGemini) / 100, barH);
  }

  ctx.restore();
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: "100%",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    overflow: "hidden",
    marginVertical: 12,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surface1,
    flexWrap: "wrap",
    gap: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9999,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#10b981",
  },
  liveText: {
    fontSize: 9,
    fontFamily: Platform.select({ web: "monospace", default: "Courier" }),
    color: "#34d399",
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
  },
  headerControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  btnAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  btnActionText: {
    fontSize: 11,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  canvasWrap: {
    width: "100%",
    height: 480,
    backgroundColor: "#070a12",
    position: "relative",
    overflow: "hidden",
  },
  canvasWrapExpanded: {
    height: 640,
  },
  floatingHint: {
    position: "absolute",
    top: 10,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(51, 65, 85, 0.5)",
  },
  hintText: {
    fontSize: 10,
    color: "#94a3b8",
    fontFamily: Platform.select({ web: "monospace", default: "Courier" }),
  },
  legendBar: {
    position: "absolute",
    bottom: 10,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(51, 65, 85, 0.5)",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 10,
    color: "#cbd5e1",
    fontWeight: "500",
  },
  nodeInspector: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 170,
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  inspectorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inspectorTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#f8fafc",
  },
  inspectorTier: {
    fontSize: 9,
    fontFamily: Platform.select({ web: "monospace", default: "Courier" }),
    color: "#38bdf8",
    fontWeight: "700",
  },
  inspectorSub: {
    fontSize: 10,
    color: "#94a3b8",
    marginTop: 2,
  },
  inspectorDivider: {
    height: 1,
    backgroundColor: "rgba(51, 65, 85, 0.6)",
    marginVertical: 6,
  },
  inspectorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 2,
  },
  inspectorKey: {
    fontSize: 10,
    color: "#64748b",
  },
  inspectorVal: {
    fontSize: 10,
    fontFamily: Platform.select({ web: "monospace", default: "Courier" }),
    fontWeight: "700",
    color: "#f8fafc",
  },
}));
