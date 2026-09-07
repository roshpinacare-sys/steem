/**
 * CodeView — syntax-highlighted read view for the Files page, Docs code
 * fences, and anywhere else source is displayed. Loaded ONLY through
 * React.lazy so the highlighter (vendor-syntax chunk) never weighs down the
 * initial bundle. PrismLight with a hand-picked language set keeps it lean.
 */
import React from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import ts from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import js from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { MONO, UI } from "./ui.js";

SyntaxHighlighter.registerLanguage("typescript", ts);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("javascript", js);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("diff", diff);

export function CodeView({ code, language, maxHeight }: { code: string; language: string; maxHeight?: number | string }): React.ReactElement {
  return (
    <div style={{ overflow: "auto", maxHeight, borderRadius: 10 }}>
      <SyntaxHighlighter
        language={language === "text" ? "markdown" : language}
        style={vscDarkPlus}
        showLineNumbers={code.split("\n").length > 8}
        lineNumberStyle={{ color: UI.textMuted, opacity: 0.5, minWidth: "2.4em" }}
        customStyle={{
          margin: 0,
          background: "transparent",
          fontSize: 12,
          lineHeight: 1.6,
          fontFamily: MONO,
          padding: "12px 14px",
        }}
        codeTagProps={{ style: { fontFamily: MONO } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export default CodeView;
