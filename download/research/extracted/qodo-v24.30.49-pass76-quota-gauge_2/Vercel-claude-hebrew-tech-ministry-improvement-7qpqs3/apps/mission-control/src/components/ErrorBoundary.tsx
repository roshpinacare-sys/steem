/**
 * ErrorBoundary — catches React render errors and shows a minimal fallback.
 * Wraps the Three.js Canvas and other crash-prone subtrees.
 */
import React from "react";
import { COLOR } from "../utils/styles.js";

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "Unknown render error";
    return { hasError: true, message };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label ?? "root"}]`, error, info);
  }

  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: COLOR.bgBase,
          color: COLOR.red,
          fontFamily: "system-ui, sans-serif",
          gap: 12,
          padding: 24,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          {this.props.label ?? "Component"} crashed
        </div>
        <div
          style={{
            fontSize: 12,
            color: COLOR.textMuted,
            maxWidth: 460,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {this.state.message}
        </div>
        <button
          onClick={() => this.setState({ hasError: false, message: "" })}
          style={{
            marginTop: 8,
            padding: "8px 20px",
            borderRadius: 10,
            border: `1px solid ${COLOR.borderRed}`,
            background: "rgba(248,113,113,0.1)",
            color: COLOR.red,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
