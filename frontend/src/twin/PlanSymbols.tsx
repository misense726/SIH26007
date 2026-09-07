export type PlanSymbolKind =
  | "primary"
  | "peer"
  | "mine"
  | "crusher"
  | "yard"
  | "rock"
  | "road"
  | "route"
  | "pit"
  | "selected";

/** Shared by the map and its key, so a symbol has one meaning in both. */
export function PlanSymbol({ kind }: { kind: PlanSymbolKind }) {
  if (kind === "primary" || kind === "peer")
    return (
      <g>
        <rect
          x="-9"
          y="-10"
          width="18"
          height="22"
          rx="3"
          fill={kind === "primary" ? "#e4ad32" : "#4a86a8"}
          stroke="#243c48"
          strokeWidth="1.5"
        />
        <path
          d="M-5-5H5V0H-5ZM-5 4H5V9H-5Z"
          fill={kind === "primary" ? "#715421" : "#d2e4ee"}
        />
        <path
          d="M-4-14L0-18L4-14"
          fill="none"
          stroke="#243c48"
          strokeWidth="2"
        />
      </g>
    );
  if (kind === "rock")
    return (
      <g>
        <path
          d="M0-13L14 11H-14Z"
          fill="#ffdc83"
          stroke="#986219"
          strokeWidth="1.5"
        />
        <path d="M-5 6L-4 0L2-3L6 4L3 7Z" fill="#69533c" />
      </g>
    );
  if (kind === "selected")
    return (
      <circle
        r="12"
        fill="none"
        stroke="#2477c9"
        strokeWidth="2"
        strokeDasharray="3 3"
      />
    );
  if (kind === "road")
    return (
      <rect
        x="-15"
        y="-6"
        width="30"
        height="12"
        rx="2"
        fill="#d3bf98"
        stroke="#9b8660"
      />
    );
  if (kind === "route")
    return <path d="M-15 0H15" stroke="#2477c9" strokeWidth="3" />;
  if (kind === "pit")
    return (
      <g fill="none" stroke="#937a60" strokeWidth="2">
        <path d="M-14-9H14V9H-14ZM-9-4H9V9M-4 1H4V9" />
      </g>
    );
  return (
    <g>
      <rect
        x="-13"
        y="-13"
        width="26"
        height="26"
        rx="5"
        fill="#f8faf8"
        stroke="#3c5b65"
        strokeWidth="1.5"
      />
      {kind === "mine" ? (
        <path
          d="M-8 7H8M-6 2H6M-3-3H3M0-8V-3"
          stroke="#796449"
          strokeWidth="2.5"
        />
      ) : kind === "crusher" ? (
        <g fill="none" stroke="#3c5b65" strokeWidth="1.7">
          <path d="M-8-7H8L4 1H-4ZM0 1V7M-7 8H7M-8-7V8M8-7V8" />
        </g>
      ) : (
        <path
          d="M-8 7V-3L0-8L8-3V7ZM-3 7V0H3V7"
          fill="none"
          stroke="#3c5b65"
          strokeWidth="1.7"
        />
      )}
    </g>
  );
}

export function PlanLegend({ routeVisible }: { routeVisible: boolean }) {
  const entries: [PlanSymbolKind, string][] = [
    ["primary", "Primary dumper"],
    ["peer", "Other dumper"],
    ["selected", "Selected vehicle"],
    ["mine", "Mine loading bay"],
    ["crusher", "Crusher / unloading"],
    ["yard", "Service yard"],
    ["road", "Haul road"],
    ["pit", "Pit benches / no access"],
    ...(routeVisible
      ? [["route", "Assigned route"] as [PlanSymbolKind, string]]
      : []),
    ["rock", "Rock encounter"],
  ];
  return (
    <aside className="mine-plan-legend" aria-label="Mine map legend">
      <h3>Map legend</h3>
      <ul>
        {entries.map(([kind, label]) => (
          <li key={kind}>
            <svg viewBox="-20 -20 40 40" aria-hidden="true">
              <PlanSymbol kind={kind} />
            </svg>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <p>
        Arrows show vehicle heading. A ! badge means attention is needed; ?
        means unknown or lost. Positions use local metres.
      </p>
    </aside>
  );
}
