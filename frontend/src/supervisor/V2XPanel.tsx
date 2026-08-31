import { useState, type KeyboardEvent } from "react";
import { formatNumber } from "../state/selectors";
import type { V2IAdvisoryType, V2XState } from "../types";

interface V2XPanelProps {
  v2x?: V2XState;
}

interface BroadcastNotice {
  type: "success" | "error" | "info";
  message: string;
}

type V2XTab = "peers" | "advisories" | "log";

const V2X_TABS: V2XTab[] = ["peers", "advisories", "log"];

function formatPacketTime(timestampMs: number): string {
  if (!timestampMs) return "--:--:--";
  const date = new Date(timestampMs);
  return date.toTimeString().split(" ")[0];
}

export function V2XPanel({ v2x }: V2XPanelProps) {
  const [activeTab, setActiveTab] = useState<V2XTab>("peers");
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastNotice, setBroadcastNotice] = useState<BroadcastNotice | null>(null);

  if (!v2x) {
    return (
      <article className="operations-card v2x-card" aria-label="Simulated V2X monitor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SIMULATED V2X</p>
            <h2>Vehicle coordination</h2>
          </div>
          <span className="source-badge">SIMULATED</span>
        </div>
        <p className="v2x-empty-state">Simulation data unavailable.</p>
      </article>
    );
  }

  if (!v2x.enabled) {
    return (
      <article className="operations-card v2x-card" aria-label="Simulated V2X monitor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SIMULATED V2X</p>
            <h2>Vehicle coordination</h2>
          </div>
          <span className="source-badge">SIMULATED</span>
        </div>
        <p className="v2x-empty-state">V2X simulation paused.</p>
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
      setBroadcastNotice({ type: "info", message: "Sending advisory in simulation..." });
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

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(errorText || `HTTP ${res.status}`);
      }

      setBroadcastNotice({
        type: "success",
        message: `Advisory "${title}" sent in simulation.`,
      });
      setTimeout(() => setBroadcastNotice(null), 4500);
    } catch {
      setBroadcastNotice({
        type: "error",
        message: "Advisory could not be sent.",
      });
      setTimeout(() => setBroadcastNotice(null), 5000);
    } finally {
      setIsBroadcasting(false);
    }
  };

  const activePeers = v2x.active_peers ?? [];
  const infrastructureNodes = v2x.infrastructure_nodes ?? [];
  const activeAdvisories = v2x.active_advisories ?? [];
  const recentMessages = v2x.recent_messages ?? [];

  const selectTabFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: V2XTab,
  ) => {
    const currentIndex = V2X_TABS.indexOf(currentTab);
    let nextTab: V2XTab | null = null;

    if (event.key === "ArrowRight") {
      nextTab = V2X_TABS[(currentIndex + 1) % V2X_TABS.length];
    } else if (event.key === "ArrowLeft") {
      nextTab = V2X_TABS[(currentIndex - 1 + V2X_TABS.length) % V2X_TABS.length];
    } else if (event.key === "Home") {
      nextTab = V2X_TABS[0];
    } else if (event.key === "End") {
      nextTab = V2X_TABS[V2X_TABS.length - 1];
    }

    if (!nextTab) return;
    event.preventDefault();
    setActiveTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`v2x-tab-${nextTab}`)?.focus());
  };

  return (
    <article className="operations-card v2x-card" aria-label="Simulated V2X monitor">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">SIMULATED V2X</p>
          <h2>V2X simulation</h2>
        </div>
        <div className="v2x-header-badges">
          <span className="source-badge">SIMULATED</span>
          <span className="v2x-stat-pill">
            Sent: <strong>{v2x.tx_packet_count}</strong> | Received: <strong>{v2x.rx_packet_count}</strong>
          </span>
        </div>
      </div>

      <div className="v2x-tabs" role="tablist" aria-label="V2X sections">
        <button
          type="button"
          id="v2x-tab-peers"
          className={`v2x-tab-btn ${activeTab === "peers" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "peers"}
          aria-controls="v2x-tabpanel-peers"
          tabIndex={activeTab === "peers" ? 0 : -1}
          onClick={() => setActiveTab("peers")}
          onKeyDown={(event) => selectTabFromKeyboard(event, "peers")}
        >
          Peers ({activePeers.length})
        </button>
        <button
          type="button"
          id="v2x-tab-advisories"
          className={`v2x-tab-btn ${activeTab === "advisories" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "advisories"}
          aria-controls="v2x-tabpanel-advisories"
          tabIndex={activeTab === "advisories" ? 0 : -1}
          onClick={() => setActiveTab("advisories")}
          onKeyDown={(event) => selectTabFromKeyboard(event, "advisories")}
        >
          Advisories ({activeAdvisories.length})
        </button>
        <button
          type="button"
          id="v2x-tab-log"
          className={`v2x-tab-btn ${activeTab === "log" ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === "log"}
          aria-controls="v2x-tabpanel-log"
          tabIndex={activeTab === "log" ? 0 : -1}
          onClick={() => setActiveTab("log")}
          onKeyDown={(event) => selectTabFromKeyboard(event, "log")}
        >
          Event log ({recentMessages.length})
        </button>
      </div>

      <div className="v2x-content-body">
        {activeTab === "peers" && (
          <div
            id="v2x-tabpanel-peers"
            role="tabpanel"
            aria-labelledby="v2x-tab-peers"
            className="v2x-peers-grid"
          >
            {activePeers.length === 0 ? (
              <p className="v2x-empty-state">No simulated peers.</p>
            ) : (
              activePeers.map((peer) => (
                <div
                  key={peer.vehicle_id}
                  className={`v2x-peer-card link-${peer.link_status.toLowerCase()}`}
                >
                  <div className="v2x-peer-header">
                    <strong>{peer.vehicle_id}</strong>
                    <span className={`link-badge link-${peer.link_status.toLowerCase()}`}>
                      SIMULATED · {peer.link_status}
                    </span>
                  </div>
                  <div className="v2x-peer-stats">
                    <div>
                      <span>Distance</span>
                      <strong>{formatNumber(peer.distance_m, 1)} m</strong>
                    </div>
                    <div>
                      <span>Speed</span>
                      <strong>{formatNumber(peer.speed_mps * 3.6, 1)} km/h</strong>
                    </div>
                    <div>
                      <span>Heading</span>
                      <strong>{Math.round(peer.heading_deg)}°</strong>
                    </div>
                    <div>
                      <span>State</span>
                      <strong
                        className={`status-${peer.emergency_state.toLowerCase().replaceAll("_", "-")}`}
                      >
                        {peer.emergency_state.replaceAll("_", " ")}
                      </strong>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "advisories" && (
          <div
            id="v2x-tabpanel-advisories"
            role="tabpanel"
            aria-labelledby="v2x-tab-advisories"
            className="v2x-advisories-view"
          >
            {infrastructureNodes.length > 0 && (
              <div className="v2x-infrastructure-summary">
                <span className="v2x-rsu-title">Simulated roadside units ({infrastructureNodes.length})</span>
                <div className="v2x-rsu-chips">
                  {infrastructureNodes.map((rsu) => (
                    <span
                      key={rsu.rsu_id}
                      className={`v2x-rsu-chip rsu-${rsu.status.toLowerCase()}`}
                    >
                      <strong>{rsu.name}</strong> ({rsu.coverage_radius_m}m simulation radius · {rsu.active_advisories_count} active)
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="v2x-quick-actions">
              <span className="v2x-actions-label">Send advisory</span>
              <button
                type="button"
                className="v2x-action-btn fog-btn"
                disabled={isBroadcasting}
                onClick={() =>
                  handleBroadcast(
                    "FOG_WARNING",
                    "Dense fog warning",
                    "Low visibility ahead. Maximum vehicle speed restricted to 20 km/h.",
                    20,
                  )
                }
              >
                Fog warning (20 km/h)
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
                Berm hazard
              </button>
              <button
                type="button"
                className="v2x-action-btn priority-btn"
                disabled={isBroadcasting}
                onClick={() =>
                  handleBroadcast(
                    "PASSAGE_PRIORITY",
                    "Narrow Pit Priority Granted",
                    "The assigned loaded vehicle has passage priority on North Ramp.",
                  )
                }
              >
                Passage priority
              </button>
              <button
                type="button"
                className="v2x-action-btn maintenance-btn"
                disabled={isBroadcasting}
                onClick={() =>
                  handleBroadcast(
                    "ROAD_MAINTENANCE",
                    "Active Road Maintenance",
                    "Grading operation active on Main Haul Road. Single lane traffic.",
                    15,
                  )
                }
              >
                Road maintenance
              </button>
              <button
                type="button"
                className="v2x-action-btn restriction-btn"
                disabled={isBroadcasting}
                onClick={() =>
                  handleBroadcast(
                    "SPEED_RESTRICTION",
                    "Pit Ramp Speed Restriction",
                    "Wet ramp conditions. Pit speed restricted to 15 km/h.",
                    15,
                  )
                }
              >
                Speed limit (15 km/h)
              </button>
            </div>

            {broadcastNotice && (
              <div
                className={`v2x-broadcast-notice notice-${broadcastNotice.type}`}
                role="status"
                aria-live="polite"
              >
                {broadcastNotice.message}
              </div>
            )}

            <div className="v2x-advisories-list">
              {activeAdvisories.length === 0 ? (
                <p className="v2x-empty-state">No simulated advisories.</p>
              ) : (
                activeAdvisories.map((adv) => (
                  <div
                    key={adv.message_id}
                    className={`v2x-advisory-item adv-${adv.advisory_type.toLowerCase()}`}
                  >
                    <div className="v2x-advisory-header">
                      <span className="v2x-adv-type-badge">
                        {adv.advisory_type.replaceAll("_", " ")}
                      </span>
                      <span className="v2x-adv-source">{adv.rsu_name}</span>
                    </div>
                    <h4>{adv.title}</h4>
                    <p>{adv.detail}</p>
                    <div className="v2x-advisory-meta">
                      {adv.speed_limit_kmh !== null && (
                        <span className="v2x-speed-cap">Speed limit: {adv.speed_limit_kmh} km/h</span>
                      )}
                      {adv.zone_x_m !== null && adv.zone_y_m !== null && (
                        <span className="v2x-adv-coords">
                          Zone: ({formatNumber(adv.zone_x_m, 1)}m, {formatNumber(adv.zone_y_m, 1)}m)
                          {adv.zone_radius_m ? ` • r=${adv.zone_radius_m}m` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "log" && (
          <div
            id="v2x-tabpanel-log"
            role="tabpanel"
            aria-labelledby="v2x-tab-log"
            className="v2x-packet-log"
          >
            {recentMessages.length === 0 ? (
              <p className="v2x-empty-state">No simulation events logged.</p>
            ) : (
              recentMessages
                .slice(-16)
                .reverse()
                .map((msg) => (
                  <div
                    key={msg.message_id}
                    className={`v2x-log-row type-${msg.msg_type.toLowerCase()}`}
                  >
                    <span className="v2x-log-time">{formatPacketTime(msg.timestamp_ms)}</span>
                    <span className="v2x-log-type">{msg.msg_type.replaceAll("_", " ")}</span>
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
