"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Hero Canvas - הרשת החיה שמאחורי ההיירו.
//
// סימולציית אימות חיה: סוכנים (צמתים זוהרים) שטים במרחב, קשרי-אמת
// (חוטים) נוצרים ונקרעים לפי מרחק, ופעימות-עדות (גראדיאנטים) זורמות
// על החוטים אל "ספר האימותים" שבמרכז. כבוד מלא ל prefers-reduced-motion
// (מצב סטטי), pause כשמחוץ למסך, DPR מותאם.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ledger: boolean;
}

interface Pulse {
  a: number;
  b: number;
  t: number;
  speed: number;
}

export function WeaveCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let running = true;
    let W = 0;
    let H = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const LINK_DIST = 150;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(rect.width, 1);
      H = Math.max(rect.height, 1);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      seed();
    };

    const seed = () => {
      const count = Math.min(Math.round((W * H) / 26000) + 14, 46);
      nodes = Array.from({ length: count }, (_, i) => {
        const ledger = i === 0;
        return {
          x: W * (0.08 + Math.random() * 0.84),
          y: H * (0.08 + Math.random() * 0.84),
          vx: ledger ? 0 : (Math.random() - 0.5) * 0.28,
          vy: ledger ? 0 : (Math.random() - 0.5) * 0.28,
          r: ledger ? 5.5 : 1.6 + Math.random() * 1.8,
          ledger,
        };
      });
      // הספר במרכז
      if (nodes[0]) {
        nodes[0].x = W * 0.5;
        nodes[0].y = H * 0.46;
      }
      pulses = [];
    };

    const spawnPulse = (a: number, b: number) => {
      pulses.push({ a, b, t: 0, speed: 0.012 + Math.random() * 0.01 });
      if (pulses.length > 14) pulses.shift();
    };

    let frame = 0;
    const draw = () => {
      if (!running) return;
      frame++;
      ctx.clearRect(0, 0, W, H);

      // חוטי-אמת
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            const alpha = (1 - d / LINK_DIST) * 0.32;
            const toLedger = nodes[i].ledger || nodes[j].ledger;
            ctx.strokeStyle = toLedger
              ? `rgba(16, 185, 129, ${alpha * 1.25})`
              : `rgba(113, 113, 122, ${alpha * 0.55})`;
            ctx.lineWidth = toLedger ? 1.1 : 0.7;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // פעימות-עדות זורמות אל הספר
      for (const p of pulses) {
        const A = nodes[p.a];
        const B = nodes[p.b];
        if (!A || !B) continue;
        p.t += p.speed;
        if (p.t >= 1) {
          p.t = 0;
          p.a = Math.floor(Math.random() * nodes.length);
          p.b = 0; // אל הספר
        }
        const x = A.x + (B.x - A.x) * p.t;
        const y = A.y + (B.y - A.y) * p.t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
        g.addColorStop(0, "rgba(52, 211, 153, 0.85)");
        g.addColorStop(1, "rgba(52, 211, 153, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      // צמתים
      for (const n of nodes) {
        if (n.ledger) {
          // הספר - טבעת נשימה
          const breathe = 0.5 + 0.5 * Math.sin(frame / 42);
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 26 + breathe * 8);
          g.addColorStop(0, "rgba(16, 185, 129, 0.5)");
          g.addColorStop(1, "rgba(16, 185, 129, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 26 + breathe * 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(52, 211, 153, 0.9)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 8.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "rgba(209, 250, 229, 0.95)";
          ctx.beginPath();
          ctx.arc(n.x, n.y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "rgba(161, 161, 170, 0.65)";
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (!reduced) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 8 || n.x > W - 8) n.vx *= -1;
          if (n.y < 8 || n.y > H - 8) n.vy *= -1;
        }
      }

      if (!reduced && frame % 74 === 0 && nodes.length > 1) {
        spawnPulse(Math.floor(Math.random() * nodes.length), 0);
      }

      raf = requestAnimationFrame(draw);
    };

    const onVisible = (entries: IntersectionObserverEntry[]) => {
      const visible = entries[0]?.isIntersecting ?? true;
      if (visible && !running) {
        running = true;
        raf = requestAnimationFrame(draw);
      } else if (!visible && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(onVisible, { threshold: 0.05 });
    io.observe(canvas);
    if (reduced) {
      draw();
      running = false;
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      role="presentation"
    />
  );
}
