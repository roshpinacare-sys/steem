/// <reference types="vite/client" />

/** Injected by Vite `define` from package.json — the build's version string. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_TELEMETRY_PROXY_URL: string;
  readonly VITE_QODO_PRIVACY_MODE: string;
  readonly VITE_QODO_HIVE_SHARE: string;
  [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "react-syntax-highlighter" {
  import * as React from "react";
  export interface SyntaxHighlighterProps {
    children: string;
    language?: string;
    style?: Record<string, React.CSSProperties>;
    customStyle?: React.CSSProperties;
    wrapLines?: boolean;
    showLineNumbers?: boolean;
    [key: string]: unknown;
  }
  const SyntaxHighlighter: React.ComponentType<SyntaxHighlighterProps>;
  export default SyntaxHighlighter;
  export const Prism: React.ComponentType<SyntaxHighlighterProps>;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  import * as React from "react";
  export const atomDark: Record<string, React.CSSProperties>;
  export const dracula: Record<string, React.CSSProperties>;
  export const vscDarkPlus: Record<string, React.CSSProperties>;
  export const oneDark: Record<string, React.CSSProperties>;
  const styles: Record<string, Record<string, React.CSSProperties>>;
  export default styles;
}

declare module "react-dom/client" {
  import * as React from "react";
  interface Root {
    render(children: React.ReactNode): void;
    unmount(): void;
  }
  export function createRoot(
    container: Element | DocumentFragment,
    options?: { identifierPrefix?: string },
  ): Root;
  export function hydrateRoot(
    container: Element | Document,
    children: React.ReactNode,
    options?: { identifierPrefix?: string },
  ): Root;
}
