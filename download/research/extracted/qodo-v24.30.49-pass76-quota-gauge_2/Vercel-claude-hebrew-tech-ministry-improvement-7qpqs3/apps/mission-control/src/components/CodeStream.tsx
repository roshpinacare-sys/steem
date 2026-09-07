import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTelemetryCtx } from "../context/TelemetryContext.js";
import { glassPanel, sectionLabel, langFromPath, COLOR } from "../utils/styles.js";

const DEFAULT_SNIPPET = "// Waiting for Cartographer telemetry stream…";
const TYPEWRITER_INTERVAL_MS = 18;

// ---------------------------------------------------------------------------
// Mode indicator
// ---------------------------------------------------------------------------

const StreamBadge = React.memo(function StreamBadge({
  isStreaming,
}: {
  isStreaming: boolean;
}) {
  return (
    <span
      title={isStreaming ? "Live token stream from Groq" : "Cartographer snapshot"}
      style={{
        marginLeft: 8,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: "2px 7px",
        borderRadius: 6,
        background: isStreaming
          ? "rgba(52,211,153,0.15)"
          : "rgba(99,102,241,0.15)",
        color: isStreaming ? COLOR.green : COLOR.indigoLight,
        border: `1px solid ${isStreaming ? "rgba(52,211,153,0.35)" : "rgba(99,102,241,0.35)"}`,
        transition: "all 0.3s ease",
        userSelect: "none",
      }}
    >
      {isStreaming ? "⚡ LIVE" : "📸 SNAPSHOT"}
    </span>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CodeStream = React.memo(function CodeStream() {
  // ── Snapshot mode state (Cartographer events) ──────────────────────────
  const [snippet,     setSnippet]     = useState(DEFAULT_SNIPPET);
  const [lang,        setLang]        = useState("text");
  const [visible,     setVisible]     = useState(0);

  // ── Streaming mode state (Coder stream-chunk events) ───────────────────
  const [streamBuf,   setStreamBuf]   = useState("");
  const [streamLang,  setStreamLang]  = useState("typescript");
  const [isStreaming, setIsStreaming]  = useState(false);

  const { events } = useTelemetryCtx();

  // ── Handle streaming telemetry events ──────────────────────────────────
  //
  // The agent pushes three event types during live codegen:
  //   { phase:"coder", decision:"stream-start",    path:"<file>" }
  //   { phase:"coder", decision:"stream-chunk",    chunk:"<token>" }
  //   { phase:"coder", decision:"stream-complete"                  }
  //
  useEffect(() => {
    const latest = events[events.length - 1];
    if (!latest || latest.phase !== "coder") return;

    if (latest.decision === "stream-start") {
      setIsStreaming(true);
      setStreamBuf("");
      setStreamLang(langFromPath(String(latest.path ?? "unknown")));
      return;
    }

    if (latest.decision === "stream-chunk" && typeof latest.chunk === "string") {
      setStreamBuf((prev) => prev + (latest.chunk as string));
      return;
    }

    if (latest.decision === "stream-complete") {
      // Keep the final buffer visible; leave isStreaming=true for 1 s then
      // switch badge back to snapshot so users know stream has ended.
      const t = setTimeout(() => setIsStreaming(false), 1_000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [events]);

  // ── Handle Cartographer snapshot events (when not streaming) ───────────
  useEffect(() => {
    if (isStreaming) return; // streaming takes precedence
    const latest = events
      .filter(
        (e) =>
          e.phase === "cartographer" &&
          e.decision === "file-summarized" &&
          typeof e.summary === "string",
      )
      .pop();
    if (!latest?.summary) return;
    const next = `[${String(latest.path ?? "unknown")}]\n\n${String(latest.summary)}`;
    if (next === snippet) return;
    setSnippet(next);
    setLang(langFromPath(String(latest.path ?? "")));
    setVisible(0);
  }, [events, snippet, isStreaming]);

  // ── Typewriter effect (snapshot mode only) ──────────────────────────────
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isStreaming) return;
    setVisible(0);
    intervalRef.current = setInterval(() => {
      setVisible((v) => {
        if (v >= snippet.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return v;
        }
        return v + 1;
      });
    }, TYPEWRITER_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [snippet, isStreaming]);

  // ── Displayed content: streaming buffer or typewriter slice ────────────
  const displayedCode = isStreaming ? streamBuf : snippet.slice(0, visible);
  const displayedLang = isStreaming ? streamLang : lang;

  return (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, delay: 0.4 }}
      style={{
        ...glassPanel(),
        position: "absolute",
        right: 24,
        top: 24,
        width: 420,
        height: 300,
        zIndex: 10,
        padding: 20,
        boxShadow: "0 20px 50px rgba(2,6,23,0.6)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          ...sectionLabel(),
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
        }}
      >
        Live Code Stream
        <StreamBadge isStreaming={isStreaming} />
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          borderRadius: 10,
          background: "#0b1121",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
        }}
      >
        <SyntaxHighlighter
          language={displayedLang}
          style={atomDark}
          customStyle={{
            margin: 0,
            padding: 14,
            background: "transparent",
            fontSize: 13,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            color: COLOR.textSecondary,
          }}
        >
          {displayedCode}
        </SyntaxHighlighter>
      </div>
    </motion.div>
  );
});
