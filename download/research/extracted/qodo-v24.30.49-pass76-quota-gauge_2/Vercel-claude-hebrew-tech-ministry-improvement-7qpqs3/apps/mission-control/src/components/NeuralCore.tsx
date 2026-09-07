import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars, Line, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { useTelemetryCtx } from "../context/TelemetryContext.js";

type Tier = "fast" | "heavy" | "idle";

interface NeuralNode {
  id: string;
  label: string;
  tier: Tier;
  pos: [number, number, number];
  processed: boolean;
  pulse: number;
  dependencies: string[];
}

interface TelemetrySnapshot {
  file?: string;
  tier?: string;
  phase?: string;
  decision?: string;
}

const FILE_SEED = [
  { path: "src/index.ts", deps: ["src/App.tsx"] },
  { path: "src/App.tsx", deps: ["src/components/NeuralCore.tsx", "src/components/CodeStream.tsx", "src/components/CommandPalette.tsx"] },
  { path: "src/components/NeuralCore.tsx", deps: ["src/context/TelemetryContext.tsx"] },
  { path: "src/components/CodeStream.tsx", deps: ["src/utils/stream.ts"] },
  { path: "src/components/CommandPalette.tsx", deps: ["src/utils/dispatch.ts"] },
  { path: "src/context/TelemetryContext.tsx", deps: [] },
  { path: "src/utils/stream.ts", deps: [] },
  { path: "src/utils/dispatch.ts", deps: [] },
  { path: "src/services/ai-router.ts", deps: ["src/context/TelemetryContext.tsx"] },
  { path: "src/cli.ts", deps: ["src/services/ai-router.ts", "src/App.tsx"] },
  { path: "package.json", deps: [] },
  { path: "README.md", deps: [] },
  { path: "tsconfig.json", deps: [] },
  { path: "vite.config.ts", deps: [] },
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: string): () => number {
  let s = hash(seed);
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function spherePoint(rand: () => number, radius = 8): [number, number, number] {
  const u = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [r * Math.cos(t) * radius, u * radius, r * Math.sin(t) * radius];
}

function buildNodes(): NeuralNode[] {
  const rand = seededRandom("qodo-neural-core");
  const map = new Map<string, NeuralNode>();
  for (const f of FILE_SEED) {
    const pos = spherePoint(rand);
    map.set(f.path, {
      id: f.path,
      label: f.path,
      tier: "idle",
      pos,
      processed: false,
      pulse: 0,
      dependencies: f.deps,
    });
  }
  return Array.from(map.values());
}

function NodeSphere({ node }: { node: NeuralNode }) {
  const ref = useRef<THREE.Mesh>(null);
  const color = node.tier === "fast" ? "#10b981" : node.tier === "heavy" ? "#f59e0b" : "#6366f1";

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pulse = node.pulse * Math.sin(clock.getElapsedTime() * 10) * 0.35;
    const base = node.processed ? 1.25 : 1;
    ref.current.scale.setScalar(base + pulse);
  });

  return (
    <group position={node.pos}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={node.processed ? 1.8 : 0.5}
          roughness={0.35}
          metalness={0.85}
        />
      </mesh>
      {node.processed && (
        <Sparkles count={16} scale={3.5} size={2} speed={1.5} color={color} />
      )}
    </group>
  );
}

function NeuralGraph({ nodes }: { nodes: NeuralNode[] }) {
  const edges = useMemo(() => {
    const out: { from: [number, number, number]; to: [number, number, number] }[] = [];
    const posMap = new Map<string, [number, number, number]>();
    for (const n of nodes) posMap.set(n.id, n.pos);
    for (const n of nodes) {
      for (const dep of n.dependencies) {
        const to = posMap.get(dep);
        if (to) out.push({ from: n.pos, to });
      }
    }
    return out;
  }, [nodes]);

  return (
    <group>
      {edges.map((e, i) => (
        <Line
          key={i}
          points={[e.from, e.to]}
          color="#4f46e5"
          lineWidth={1}
          transparent
          opacity={0.25}
        />
      ))}
      {nodes.map((n) => (
        <NodeSphere key={n.id} node={n} />
      ))}
    </group>
  );
}

export function NeuralCore() {
  const [nodes, setNodes] = useState<NeuralNode[]>(() => buildNodes());
  const { events } = useTelemetryCtx();

  useEffect(() => {
    if (!events.length) return;
    setNodes((prev) => {
      const next = prev.map((n) => ({ ...n }));
      for (const e of events) {
        const target = String(e.file || e.phase || "");
        if (!target) continue;
        const idx = next.findIndex((n) => n.id === target || target.includes(n.label));
        if (idx >= 0) {
          next[idx].processed = true;
          next[idx].pulse = 1;
          if (e.tier === "fast" || e.tier === "heavy") {
            next[idx].tier = e.tier as Tier;
          }
        }
      }
      return next;
    });
  }, [events]);

  // Only run the decay timer when at least one node has an active pulse.
  // This eliminates 100 % of the interval CPU cost when the graph is idle.
  const anyPulse = nodes.some((n) => n.pulse > 0);
  useEffect(() => {
    if (!anyPulse) return;
    const decay = setInterval(() => {
      setNodes((prev) =>
        prev.map((n) => ({ ...n, pulse: Math.max(0, n.pulse - 0.05) })),
      );
    }, 80);
    return () => clearInterval(decay);
  }, [anyPulse]);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
      <Canvas camera={{ position: [0, 0, 18], fov: 60 }}>
        <ambientLight intensity={0.25} />
        <pointLight position={[12, 12, 12]} intensity={1.1} color="#6366f1" />
        <pointLight position={[-12, -12, -12]} intensity={0.7} color="#10b981" />
        <Stars radius={70} depth={60} count={4000} factor={5} saturation={0} fade speed={0.6} />
        <NeuralGraph nodes={nodes} />
        <OrbitControls autoRotate autoRotateSpeed={0.35} enableZoom enablePan={false} />
      </Canvas>
    </div>
  );
}
