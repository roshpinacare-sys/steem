/**
 * LlmProvidersPanel — the "AI providers" settings surface. Add a key for any
 * provider, verify it with a live ping, pick a default. Keys are device-local.
 * This is what makes the chat's freeform LLM mode work with your own accounts.
 */
import React, { useEffect, useState } from "react";
import { UI, FONT, MONO, Panel, Button, Pill, Dot, SectionTitle } from "../ui.js";
import { Icon } from "../icons.js";
import { PROVIDERS, type ProviderId } from "./providers.js";
import { llmVerify } from "./client.js";
import {
  getKey, setKey, removeKey, getSelected, setSelected, configuredProviders, onLlmChange,
} from "./store.js";

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9,
  fontFamily: MONO, fontSize: 12.5, background: UI.bgElevated,
  border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none",
};

type VState = { state: "idle" | "checking" | "ok" | "err"; detail?: string };

export function LlmProvidersPanel(): React.ReactElement {
  const [, force] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [verify, setVerify] = useState<Record<string, VState>>({});
  const [open, setOpen] = useState<ProviderId | null>(null);

  useEffect(() => onLlmChange(() => force((n) => n + 1)), []);

  const configured = configuredProviders();
  const selected = getSelected();

  const save = async (id: ProviderId) => {
    const draft = (drafts[id] ?? "").trim();
    if (!draft) return;
    setVerify((v) => ({ ...v, [id]: { state: "checking" } }));
    const res = await llmVerify(id, draft);
    if (res.ok) {
      setKey(id, draft);
      if (!getSelected()) setSelected(id);
      setDrafts((d) => ({ ...d, [id]: "" }));
      setOpen(null);
    }
    setVerify((v) => ({ ...v, [id]: { state: res.ok ? "ok" : "err", detail: res.detail } }));
  };

  return (
    <>
      <SectionTitle>AI providers</SectionTitle>
      <Panel pad={16} style={{ marginBottom: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: UI.textMuted, lineHeight: 1.55 }}>
          Connect your own LLM accounts — keys stay on this device and are sent only to the provider you call.
          Inside the Android app these work directly; in a plain browser some providers block cross-origin calls.
        </div>

        {configured.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderBottom: `1px solid ${UI.border}` }}>
            <span style={{ fontSize: 11, color: UI.textMuted, fontWeight: 600 }}>Default for chat:</span>
            {configured.map((id) => {
              const p = PROVIDERS.find((x) => x.id === id)!;
              const on = selected === id;
              return (
                <button key={id} onClick={() => setSelected(id)} style={{
                  padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600,
                  color: on ? UI.indigoLight : UI.textMuted, background: on ? UI.bgActive : "transparent",
                  border: `1px solid ${on ? "rgba(99,102,241,0.4)" : UI.border}` }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        {PROVIDERS.map((p) => {
          const has = Boolean(getKey(p.id));
          const isOpen = open === p.id;
          const v = verify[p.id];
          return (
            <div key={p.id} style={{ border: `1px solid ${UI.border}`, borderRadius: 11, padding: "10px 12px", background: UI.bgElevated }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <Dot color={has ? UI.green : UI.textMuted} glow={has} size={7} />
                <span style={{ fontSize: 13.5, fontWeight: 650, color: UI.textPrimary }}>{p.label}</span>
                {p.hasFree && <Pill color={UI.green}>free tier</Pill>}
                {!p.browserCors && <Pill color={UI.textMuted}>app-only</Pill>}
                {has && <Pill color={UI.indigo}>connected</Pill>}
                <div style={{ flex: 1 }} />
                {has
                  ? <button onClick={() => removeKey(p.id)} style={linkBtn(UI.red)}>Remove</button>
                  : <button onClick={() => setOpen(isOpen ? null : p.id)} style={linkBtn(UI.indigoLight)}>{isOpen ? "Cancel" : "Add key"}</button>}
              </div>

              {isOpen && !has && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <input type="password" autoComplete="off" spellCheck={false} placeholder={p.keyHint}
                    value={drafts[p.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") void save(p.id); }} style={field} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Button variant="primary" onClick={() => void save(p.id)} disabled={v?.state === "checking"}>
                      {v?.state === "checking" ? "Verifying…" : "Verify & save"}
                    </Button>
                    <a href={p.keysUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: UI.indigoLight, textDecoration: "none" }}>
                      Get a key ↗
                    </a>
                    {v?.state === "err" && <span style={{ fontSize: 11.5, color: UI.red }}>{v.detail}</span>}
                  </div>
                </div>
              )}
              {v?.state === "ok" && has && <div style={{ marginTop: 6, fontSize: 11.5, color: UI.green }}><Icon name="check" size={12} /> {v.detail}</div>}
            </div>
          );
        })}
      </Panel>
    </>
  );
}

function linkBtn(color: string): React.CSSProperties {
  return { background: "none", border: "none", color, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, padding: 0 };
}
