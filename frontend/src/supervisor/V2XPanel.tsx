import { useState } from "react";
import type { V2IAdvisoryType, V2XState } from "../types";

interface V2XPanelProps {
  v2x?: V2XState;
}

export function V2XPanel({ v2x }: V2XPanelProps) {
  const [activeTab, setActiveTab] = useState<"peers" | "advisories" | "log">("peers");
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);

  if (!v2x) {
    return (
      <article className="operations-card v2x-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Vehicle-to-Everything (V2X)</p>
            <h2>V2V & V2I Communications</h2>
          </div>
          <span className="source-badge">OFFLINE</span>
        </div>
        <p className="v2x-empty-state">V2X subsystem is offline or telemetry is unavailable.</p>
      </article>
    );
  }

  const handleBroadcast = async (
    type: V2IAdvisoryType,
    title: string,
    detail: string,
    speedLimit?: number,
  ) => {
    try {
      setIsBroadcasting(true);
      setBroadcastStatus("Broadcasting...");
      const payload = {
        message_id: `ADV-${Date.now().toString(36).toUpperCase()}`,
        timestamp_ms: Date.now(),
        rsu_id: "RSU_SUPERVISOR_CONSOLE",
        rsu_name: "Central Dispatch Console",
        advisory_type: type,
        title,
        detail,
        speed_limit_kmh: speedLimit ?? null,
      };

      const res = await fetch("/api/v2x/broadcast-advisory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Broadcast failed");
      setBroadcastStatus("Advisory broadcasted to all vehicles!");
      setTimeout(() => setBroadcastStatus(null), 4000);
    } catch {
      setBroadcastStatus("Broadcast failed. Check connection.");
      setTimeout(() => setBroadcastStatus(null), 4000);
    } finally {
      setIsBroadcasting(false);
    }
  };

  const activePeers = v2x.active_peers ?? [];
  const activeAdvisories = v2x.active_advisories ?? [];
  const recentMessages = v2x.recent_messages ?? [];

  return (
    <article className="operations-card v2x-card" aria-label="V2X communications monitor">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Vehicle-to-Everything (V2X)</p>
          <h2>V2V & V2I Telemetry Exchange</h2>
        </div>
        <div className="v2x-header-badges">
          <span className="source-badge">5.89 GHz DSRC</span>
          <span className="v2x-stat-pill">
            TX: <strong>{v2x.tx_packet_count}</strong> | RX: <strong>{v2x.rx_packet_count}</strong>
          </span>
        </div>
      </div>

      <div className="v2x-tabs" role="tablist" aria-label="V2X sections">
        <button
          type="button"
          className={`v2x-tab-btn ${activeTab === "peers" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "peers"}
          onClick={() => setActiveTab("peers")}
        >
          V2V Peers ({activePeers.length})
        </button>
        <button
          type="button"
          className={`v2x-tab-btn ${activeTab === "advisories" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "advisories"}
          onClick={() => setActiveTab("advisories")}
        >
          V2I Advisories ({activeAdvisories.length})
        </button>
        <button
          type="button"
          className={`v2x-tab-btn ${activeTab === "log" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "log"}
          onClick={() => setActiveTab("log")}
        >
          Packet Log ({recentMessages.length})
        </button>
      </div>

      <div className="v2x-content-body">
        {activeTab === "peers" && (
          <div className="v2x-peers-grid">
            {activePeers.length === 0 ? (
              <p className="v2x-empty-state">No peer vehicles detected within wireless range.</p>
            ) : (
              activePeers.map((peer) => (
                <div key={peer.vehicle_id} className={`v2x-peer-card link-${peer.link_status.toLowerCase()}`}>
                  <div className="v2x-peer-header">
                    <strong>{peer.vehicle_id}</strong>
                    <span className={`link-badge link-${peer.link_status.toLowerCase()}`}>
                      {peer.link_status} ({peer.rssi_dbm} dBm)
                    </span>
                  </div>
                  <div className="v2x-peer-stats">
                    <div>
                      <span>Distance</span>
                      <strong>{peer.distance_m} m</strong>
                    </div>
                    <div>
                      <span>Speed</span>
                      <strong>{(peer.speed_mps * 3.6).toFixed(1)} km/h</strong>
                    </div>
                    <div>
                      <span>Heading</span>
                      <strong>{Math.round(peer.heading_deg)}°</strong>
                    </div>
                    <div>
                      <span>State</span>
                      <strong className={`status-${peer.emergency_state.toLowerCase()}`}>
                        {peer.emergency_state}
                      </strong>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "advisories" && (
          <div className="v2x-advisories-view">
            <div className="v2x-quick-actions">
              <span className="v2x-actions-label">Dispatch Broadcast:</span>
              <button
                type="button"
                className="v2x-action-btn fog-btn"
                disabled={isBroadcasting}
                onClick={() =>
                  handleBroadcast(
                    "FOG_WARNING",
                    "Dense Fog - Reduced Speed Limit",
                    "Low visibility ahead. Maximum vehicle speed restricted to 20 km/h.",
                    20,
                  )
                }
              >
                + Fog Warning (20 km/h)
              </button>
              <button
                type="button"
                className="v2x-action-btn hazard-btn"
                disabled={isBroadcasting}
                onClick={() =>
                  handleBroadcast(
                    "HAZARD_ZONE",
                    "Berm Shift Alert",
                    "Haul road berm shift reported at Section C. Proceed with caution.",
                  )
                }
              >
                + Berm Hazard Alert
              </button>
              <button
                type="button"
                className="v2x-action-btn priority-btn"
                disabled={isBroadcasting}
                onClick={() =>
                  handleBroadcast(
                    "PASSAGE_PRIORITY",
                    "Narrow Pit Priority Granted",
                    "Loaded dumper DUMPER_01 has passage priority on North Ramp.",
                  )
                }
              >
                + Passage Priority
              </button>
            </div>

            {broadcastStatus && <div className="v2x-broadcast-notice">{broadcastStatus}</div>}

            <div className="v2x-advisories-list">
              {activeAdvisories.length === 0 ? (
                <p className="v2x-empty-state">No active infrastructure advisories.</p>
              ) : (
                activeAdvisories.map((adv) => (
                  <div key={adv.message_id} className={`v2x-advisory-item adv-${adv.advisory_type.toLowerCase()}`}>
                    <div className="v2x-advisory-header">
                      <span className="v2x-adv-type-badge">{adv.advisory_type.replace("_", " ")}</span>
                      <span className="v2x-adv-source">{adv.rsu_name}</span>
                    </div>
                    <h4>{adv.title}</h4>
                    <p>{adv.detail}</p>
                    {adv.speed_limit_kmh !== null && (
                      <span className="v2x-speed-cap">Speed limit: {adv.speed_limit_kmh} km/h</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "log" && (
          <div className="v2x-packet-log">
            {recentMessages.length === 0 ? (
              <p className="v2x-empty-state">No V2X messages logged yet.</p>
            ) : (
              recentMessages
                .slice(-12)
                .reverse()
                .map((msg) => (
                  <div key={msg.message_id} className={`v2x-log-row type-${msg.msg_type.toLowerCase()}`}>
                    <span className="v2x-log-type">{msg.msg_type.replace("_", " ")}</span>
                    <span className="v2x-log-route">
                      {msg.source_id} &rarr; {msg.target_id}
                    </span>
                    <span className="v2x-log-summary">{msg.summary}</span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>
    </article>
  );
}
