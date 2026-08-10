import type { IntegrationDef } from "./integrationsCatalog";

export function IntegrationIcon({ icon }: { icon: IntegrationDef["icon"] }) {
  return (
    <span className={`rw-app-icon rw-app-icon--${icon}`} aria-hidden>
      {icon === "claude" && <span className="rw-mark">✳</span>}
      {icon === "calendar" && <span className="rw-mark rw-mark-cal">31</span>}
      {icon === "gmail" && <span className="rw-mark">M</span>}
      {icon === "docs" && <span className="rw-mark">D</span>}
      {icon === "tasks" && <span className="rw-mark">✓</span>}
      {icon === "whatsapp" && <span className="rw-mark">W</span>}
      {icon === "maps" && <span className="rw-mark">⌖</span>}
      {icon === "weather" && <span className="rw-mark">☀</span>}
      {icon === "youtube" && <span className="rw-mark">▶</span>}
      {icon === "spotify" && <span className="rw-mark">♪</span>}
    </span>
  );
}
