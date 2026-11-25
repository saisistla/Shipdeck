import { useEffect, useMemo, useState } from "react";
import { connectionFolder, type AuditEvent, type StoredKeyRecord } from "@shipdeck/shared";
import { api } from "./api";
import { CONN_LABELS, ConnectionBadge, IconEye, IconEyeOff, IconKey } from "./icons";

export function KeysPanel() {
  const [keys, setKeys] = useState<StoredKeyRecord[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byId = new Map<string, StoredKeyRecord[]>();
    for (const record of keys) {
      const list = byId.get(record.connectionId) ?? [];
      list.push(record);
      byId.set(record.connectionId, list);
    }
    return [...byId.values()];
  }, [keys]);

  async function refresh() {
    const [nextKeys, nextAudit] = await Promise.all([api.storedKeys(), api.audit().catch(() => [] as AuditEvent[])]);
    setKeys(nextKeys);
    setAuditLog(nextAudit.filter((event) => event.action.startsWith("keys.")));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function toggle(record: StoredKeyRecord) {
    if (record.missing) return;
    if (revealed[record.id]) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      return;
    }
    setBusyId(record.id);
    setError(null);
    try {
      const opened = await api.revealStoredKey(record.connectionId, record.secretName);
      setRevealed((current) => ({ ...current, [record.id]: opened.plaintext }));
      setAuditLog(await api.audit().then((rows) => rows.filter((event) => event.action.startsWith("keys."))));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="layout-2">
      <div className="panel">
        <div className="panel-head">
          <div className="panel-icon">
            <IconKey size={18} />
          </div>
          <h2>Saved secrets</h2>
        </div>
        <p className="muted" style={{ margin: "0 0 14px" }}>
          Each login from Logins is listed here. Show a secret only when you need it. If one says not saved, add it under Logins.
        </p>
        {error && (
          <p className="delivery-block" role="alert">
            {error}
          </p>
        )}
        {!groups.length ? (
          <p className="muted">No connections yet. Add one in Connections and it will show here.</p>
        ) : (
          <div className="key-list">
            {groups.map((records) => {
              const head = records[0];
              const folder = connectionFolder(head.connectionType);
              return (
                <article key={head.connectionId} className="key-card">
                  <div className="key-card-top">
                    <ConnectionBadge type={head.connectionType} size={32} />
                    <div className="key-card-titles">
                      <strong>{head.connectionName}</strong>
                      <span>
                        {CONN_LABELS[head.connectionType]} · {folder === "build" ? "Build" : "Deploy"}
                      </span>
                    </div>
                  </div>
                  {records.map((record) => {
                    const open = Boolean(revealed[record.id]);
                    return (
                      <div key={record.id} className={`key-slot${record.missing ? " key-slot-missing" : ""}${open ? " key-card-open" : ""}`}>
                        <div className="key-card-top">
                          <div className="key-card-titles">
                            <strong>{record.label}</strong>
                            <span>{record.missing ? "Not saved" : record.source}</span>
                          </div>
                          {!record.missing && (
                            <button
                              type="button"
                              className="btn key-eye"
                              aria-label={open ? "Hide decrypted key" : "Show decrypted key"}
                              disabled={busyId === record.id}
                              onClick={() => void toggle(record)}
                            >
                              {open ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                              {busyId === record.id ? "Opening…" : open ? "Hide" : "Show"}
                            </button>
                          )}
                        </div>
                        <dl className="key-meta">
                          <div>
                            <dt>Encrypted</dt>
                            <dd>
                              <code>{record.encrypted}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Masked</dt>
                            <dd>
                              <code>{record.masked}</code>
                            </dd>
                          </div>
                          {!record.missing && (
                            <div>
                              <dt>Fingerprint</dt>
                              <dd>
                                <code>{record.fingerprint}</code>
                              </dd>
                            </div>
                          )}
                        </dl>
                        {open && (
                          <div className="key-plain">
                            <p>Decrypted — handle as a secret. This reveal is audited.</p>
                            <textarea readOnly value={revealed[record.id]} rows={8} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </article>
              );
            })}
          </div>
        )}
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Who viewed a secret</h2>
        </div>
        {!auditLog.length ? (
          <p className="muted">No key reveals yet. Opening a key with the eye adds a row here.</p>
        ) : (
          <ul className="key-audit">
            {auditLog.map((event) => (
              <li key={event.id}>
                <strong>{event.action}</strong>
                <span>{event.detail}</span>
                <em>
                  {event.actor || "operator"} · {new Date(event.at).toLocaleString()}
                </em>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
