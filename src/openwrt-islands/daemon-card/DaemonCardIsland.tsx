import { useCallback, useEffect, useState } from "react";
import {
  getHostConfig,
  getRuntimeStatus,
  restartService,
  setHostConfig,
  type HostConfig,
} from "./ubus";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

const EMPTY_DRAFT: HostConfig = {
  enabled: false,
  listenAddr: "",
  listenPort: "",
  httpProxy: "",
  httpsProxy: "",
  logLevel: "info",
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function deriveHealth(
  running: boolean,
  reachable: boolean,
): { label: string; tone: string } {
  if (!running) return { label: "Stopped", tone: "muted" };
  if (!reachable) return { label: "Degraded", tone: "warning" };
  return { label: "Healthy", tone: "success" };
}

export function DaemonCardIsland() {
  const [draft, setDraft] = useState<HostConfig>(EMPTY_DRAFT);
  const [saved, setSaved] = useState<HostConfig>(EMPTY_DRAFT);
  const [running, setRunning] = useState<boolean>(false);
  const [reachable, setReachable] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "save" | "restart">("idle");
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([
        getHostConfig(),
        getRuntimeStatus().catch(() => null),
      ]);
      const next: HostConfig = {
        enabled: cfg.enabled,
        listenAddr: cfg.listenAddr,
        listenPort: cfg.listenPort,
        httpProxy: cfg.httpProxy,
        httpsProxy: cfg.httpsProxy,
        logLevel: cfg.logLevel,
      };
      setSaved(next);
      setDraft(next);
      if (status) {
        const svc = status.service;
        const rt = status.runtime;
        setRunning(Boolean(svc?.running ?? rt?.running));
        setReachable(Boolean(svc?.reachable));
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isDirty =
    draft.listenAddr !== saved.listenAddr ||
    draft.listenPort !== saved.listenPort ||
    draft.httpProxy !== saved.httpProxy ||
    draft.httpsProxy !== saved.httpsProxy ||
    draft.logLevel !== saved.logLevel;

  async function handleSave() {
    setBusy("save");
    setNote(null);
    try {
      const result = await setHostConfig(draft);
      if (!result.ok) {
        throw new Error(result.error ?? "save failed");
      }
      setSaved(draft);
      setNote("Saved.");
    } catch (err) {
      setNote(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy("idle");
    }
  }

  async function handleRestart() {
    setBusy("restart");
    setNote(null);
    try {
      const result = await restartService();
      if (!result.ok) {
        throw new Error(result.error ?? "restart failed");
      }
      setNote("Restart requested.");
      setTimeout(() => {
        void refresh();
      }, 1500);
    } catch (err) {
      setNote(`Restart failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy("idle");
    }
  }

  const statusLabel = running ? "Running" : "Stopped";
  const { label: healthText, tone: healthTone } = deriveHealth(running, reachable);
  const logLevelOptions = LOG_LEVELS.includes(draft.logLevel as typeof LOG_LEVELS[number])
    ? LOG_LEVELS
    : ([draft.logLevel, ...LOG_LEVELS] as readonly string[]);

  return (
    <section className="daemon-card" aria-label="Daemon control">
      <div className="daemon-row">
        <div className="daemon-status">
          <span className="dot"></span>
          {statusLabel}
        </div>
        <span className={`chip ${healthTone} dot`}>{healthText}</span>
        <label className="chip-select">
          <select
            id="logLevel"
            value={draft.logLevel}
            onChange={(e) =>
              setDraft((d) => ({ ...d, logLevel: e.target.value }))
            }
          >
            {logLevelOptions.map((lvl) => (
              <option key={lvl} value={lvl}>
                {cap(lvl)}
              </option>
            ))}
          </select>
        </label>
        <span></span>
        <button
          className="pill primary"
          id="restartBtn"
          onClick={handleRestart}
          disabled={busy !== "idle"}
        >
          {busy === "restart" ? "Restarting…" : "Restart"}
        </button>
        <button
          className="pill"
          id="saveConfigBtn"
          title="Persist current daemon config to /etc/config/ccswitch via UCI"
          onClick={handleSave}
          disabled={busy !== "idle" || !isDirty}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: -2 }}
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="daemon-divider"></div>

      <div className="daemon-grid">
        <div className="field">
          <label className="cell-label" htmlFor="listenAddr">
            Listen address
          </label>
          <input
            className="field-input mono"
            id="listenAddr"
            value={draft.listenAddr}
            onChange={(e) =>
              setDraft((d) => ({ ...d, listenAddr: e.target.value }))
            }
          />
        </div>
        <div className="field">
          <label className="cell-label" htmlFor="listenPort">
            Listen port
          </label>
          <input
            className="field-input mono"
            id="listenPort"
            value={draft.listenPort}
            onChange={(e) =>
              setDraft((d) => ({ ...d, listenPort: e.target.value }))
            }
          />
        </div>
        <div className="field">
          <label className="cell-label" htmlFor="httpProxy">
            HTTP proxy
          </label>
          <input
            className="field-input mono"
            id="httpProxy"
            value={draft.httpProxy}
            onChange={(e) =>
              setDraft((d) => ({ ...d, httpProxy: e.target.value }))
            }
          />
        </div>
        <div className="field">
          <label className="cell-label" htmlFor="httpsProxy">
            HTTPS proxy
          </label>
          <input
            className="field-input mono"
            id="httpsProxy"
            value={draft.httpsProxy}
            onChange={(e) =>
              setDraft((d) => ({ ...d, httpsProxy: e.target.value }))
            }
          />
        </div>
      </div>

      {(note || loadError) ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: loadError ? "#c0392b" : "var(--muted)",
          }}
        >
          {loadError ?? note}
        </div>
      ) : null}
    </section>
  );
}
