import { useId, type ReactNode } from "react";
import type { ConnectionType, PipelineBoxType } from "@shipdeck/shared";

type IconProps = { size?: number; className?: string; title?: string };

function Svg({
  size = 20,
  className,
  title,
  children,
  viewBox = "0 0 24 24",
}: IconProps & { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Illustrated step. Used where a picture replaces a paragraph. */
export function FlowScene({
  scene,
  plain = false,
}: {
  scene: "logins" | "ticket" | "ship" | "plan" | "code" | "tests" | "approve" | "live" | "sales" | "marketing";
  plain?: boolean;
}) {
  const frame = (children: ReactNode) => (
    <svg viewBox="0 0 160 96" className="flow-scene" role="img" aria-hidden="true">
      {plain ? null : <rect width="160" height="96" rx="14" fill="#F7F3EC" />}
      {children}
    </svg>
  );
  if (scene === "logins") {
    return frame(
      <>
        <rect x="18" y="28" width="36" height="36" rx="10" fill="#1868DB" />
        <path d="M36 36l8 8-8 8-3-3 5-5-5-5 3-3z" fill="#fff" />
        <rect x="62" y="28" width="36" height="36" rx="10" fill="#24292F" />
        <circle cx="74" cy="50" r="3" fill="#fff" />
        <circle cx="86" cy="40" r="3" fill="#fff" />
        <path d="M74 47V42h12" stroke="#fff" strokeWidth="1.6" />
        <rect x="106" y="28" width="36" height="36" rx="10" fill="#5B3CC4" />
        <circle cx="118" cy="42" r="3" fill="#F4C15D" />
        <circle cx="130" cy="42" r="3" fill="#7EC8C4" />
        <circle cx="124" cy="52" r="3" fill="#fff" />
      </>
    );
  }
  if (scene === "ticket") {
    return frame(
      <>
        <rect x="28" y="18" width="72" height="60" rx="10" fill="#fff" stroke="#E3D9CB" />
        <rect x="28" y="18" width="72" height="16" rx="10" fill="#1868DB" />
        <rect x="28" y="28" width="72" height="8" fill="#1868DB" />
        <text x="40" y="30" fill="#fff" fontSize="9" fontFamily="Georgia, serif">KAN-1</text>
        <rect x="38" y="44" width="50" height="5" rx="2" fill="#E3D9CB" />
        <rect x="38" y="54" width="38" height="5" rx="2" fill="#E7F0F8" />
        <path d="M112 48h18M122 42l8 6-8 6" stroke="#1B4F8A" strokeWidth="2" fill="none" strokeLinecap="round" />
      </>
    );
  }
  if (scene === "ship") {
    return frame(
      <>
        <rect x="18" y="22" width="40" height="50" rx="8" fill="#fff" stroke="#E3D9CB" />
        <path d="M28 48l6 6 12-14" stroke="#1F7A4D" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M70 46h16M80 40l8 6-8 6" stroke="#C4A574" strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="96" y="24" width="46" height="46" rx="12" fill="#1B4F8A" />
        <path d="M119 34l8 16h-4l-4-8-4 8h-4l8-16z" fill="#F6F1E8" />
        <path d="M108 62h22" stroke="#C4A574" strokeWidth="3" strokeLinecap="round" />
      </>
    );
  }
  if (scene === "plan") {
    return frame(
      <>
        <rect x="46" y="16" width="68" height="64" rx="8" fill="#fff" stroke="#1B4F8A" />
        <rect x="58" y="28" width="44" height="5" rx="2" fill="#1B4F8A" />
        <rect x="58" y="40" width="36" height="4" rx="2" fill="#E3D9CB" />
        <rect x="58" y="50" width="28" height="4" rx="2" fill="#E7F0F8" />
        <rect x="58" y="60" width="40" height="4" rx="2" fill="#E3D9CB" />
      </>
    );
  }
  if (scene === "code") {
    return frame(
      <>
        <rect x="36" y="20" width="88" height="56" rx="10" fill="#122033" />
        <text x="52" y="52" fill="#7EC8C4" fontSize="22" fontFamily="Consolas, monospace">{"</>"}</text>
      </>
    );
  }
  if (scene === "tests") {
    return frame(
      <>
        <rect x="48" y="18" width="64" height="60" rx="8" fill="#fff" stroke="#E3D9CB" />
        <path d="M62 40l5 5 10-12" stroke="#1F7A4D" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M62 58l5 5 10-12" stroke="#1F7A4D" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </>
    );
  }
  if (scene === "approve") {
    return frame(
      <>
        <circle cx="80" cy="48" r="26" fill="#E7F0F8" />
        <path d="M68 48l8 8 16-18" stroke="#1B4F8A" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      </>
    );
  }
  if (scene === "sales") {
    return frame(
      <>
        <rect x="28" y="22" width="104" height="54" rx="10" fill="#fff" stroke="#1B4F8A" />
        <circle cx="48" cy="40" r="7" fill="#1B4F8A" />
        <rect x="62" y="36" width="52" height="4" rx="2" fill="#1B4F8A" />
        <rect x="62" y="44" width="36" height="3" rx="1.5" fill="#C4A574" />
        <rect x="40" y="58" width="76" height="3" rx="1.5" fill="#E3D9CB" />
      </>
    );
  }
  if (scene === "marketing") {
    return frame(
      <>
        <rect x="28" y="24" width="104" height="48" rx="10" fill="#fff" stroke="#1B4F8A" />
        <path d="M46 58V38l28-8v28L46 58z" fill="#1B4F8A" />
        <path d="M74 42c6 2 8 8 6 14" stroke="#C4A574" strokeWidth="3" fill="none" strokeLinecap="round" />
      </>
    );
  }
  return frame(
    <>
      <circle cx="80" cy="46" r="24" fill="#1B4F8A" />
      <path d="M80 30c8 6 12 12 12 18a12 12 0 1 1-24 0c0-6 4-12 12-18z" fill="#C4A574" />
      <circle cx="80" cy="48" r="5" fill="#F6F1E8" />
    </>
  );
}

/** Product mark: navy hull, brass sail. Matches the app chrome. */
export function ShipdeckLogo({ size = 36, className }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <Svg size={size} className={className} viewBox="0 0 40 40" title="Shipdeck">
      <defs>
        <linearGradient id={gid} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16324A" />
          <stop offset="1" stopColor="#1E4E79" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gid})`} />
      <path d="M7 28.5c2.4 2.2 6.8 3.6 13 3.6s10.6-1.4 13-3.6H7z" fill="#C4A574" />
      <path d="M20 7.5l8.5 18h-4.2L20 14.2 15.7 25.5H11.5L20 7.5z" fill="#F6F1E8" />
      <path d="M20 14.2L23.2 21h-6.4L20 14.2z" fill="#C4A574" />
    </Svg>
  );
}

export function IconPipeline({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M4 8h6v3H4V8zm10 0h6v3h-6V8zm10 0h6v3h-6V8zM7 11v5h3v-5H7zm10 0v5h3v-5h-3zm10 0v5h3v-5h-3zM4 16h6v3H4v-3zm10 0h6v3h-6v-3zm10 0h6v3h-6v-3z"
        fill="currentColor"
      />
    </Svg>
  );
}

export function IconHistory({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M12 4a8 8 0 1 1-7.5 10.7l1.8-.6A6 6 0 1 0 12 6v3l4-3.5L12 2v2z"
        fill="currentColor"
      />
      <path d="M11 9h2v4.2l2.8 1.6-.9 1.6L11 14V9z" fill="currentColor" />
    </Svg>
  );
}

export function IconPlug({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M8 3v5H6v2.2A5.8 5.8 0 0 0 11.8 16H12v5h2v-5h.2A5.8 5.8 0 0 0 20 10.2V8h-2V3h-2v5h-4V3H8z"
        fill="currentColor"
      />
    </Svg>
  );
}

export function IconMarketing({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 15V9l9-3v12L4 15z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13 8.5v7M16 9c1.4 1.2 2 2.6 2 4s-.6 2.8-2 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

export function IconSales({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M8 7.5h8M8 12h8M8 16.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16.5" cy="15.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M18.8 17.8 21 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

export function IconBrief({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M7 3.5h7.2L19 8.2V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7zm7 1.2V8h3.2M8.5 12h7M8.5 15.5h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconPlay({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 5.5v13l11-6.5L8 5.5z" fill="currentColor" />
    </Svg>
  );
}

export function IconKey({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M14.5 8.5a4.5 4.5 0 1 0-4.2 6H8v2H6v2H4v2h5.2l1.1-1.1A4.5 4.5 0 0 0 14.5 8.5zm-4.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
        fill="currentColor"
      />
    </Svg>
  );
}

export function IconEye({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M12 6c5.2 0 9.2 4.2 10 6-.8 1.8-4.8 6-10 6S2.8 13.8 2 12c.8-1.8 4.8-6 10-6zm0 3.2A2.8 2.8 0 1 0 12 15.2 2.8 2.8 0 0 0 12 9.2z"
        fill="currentColor"
      />
    </Svg>
  );
}

export function IconEyeOff({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M3.2 4.4l16.4 16.4-1.4 1.4-2.6-2.6A11.6 11.6 0 0 1 12 18c-5.2 0-9.2-4.2-10-6 .4-.9 1.6-2.8 3.5-4.4L1.8 5.8 3.2 4.4zM12 6c5.2 0 9.2 4.2 10 6-.3.7-1.1 2.1-2.5 3.5l-2.2-2.2A4.8 4.8 0 0 0 12 8.2c-.4 0-.8 0-1.1.1L8.6 6.1C9.7 6 10.8 6 12 6z"
        fill="currentColor"
      />
    </Svg>
  );
}

export function IconCloud({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M7.5 18.5h10.2A4.3 4.3 0 0 0 22 14.4a4.2 4.2 0 0 0-3.7-4.1A5.5 5.5 0 0 0 8.2 8.4 4.4 4.4 0 0 0 4 12.7c0 3.2 2.4 5.8 3.5 5.8z"
        fill="currentColor"
      />
    </Svg>
  );
}

export function IconChevron({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M9 5l6 7-6 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const STAGE_PATHS: Record<PipelineBoxType, ReactNode> = {
  source: (
    <>
      <path
        d="M12 3l7 3.5v5.2c0 4.3-2.9 7.4-7 8.8-4.1-1.4-7-4.5-7-8.8V6.5L12 3z"
        fill="currentColor"
        opacity=".18"
      />
      <path
        d="M12 4.2l5.8 2.9v4.6c0 3.4-2.3 5.9-5.8 7.1-3.5-1.2-5.8-3.7-5.8-7.1V7.1L12 4.2z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M9.2 12.2l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  infra: (
    <>
      <rect x="4" y="14" width="16" height="6" rx="1.5" fill="currentColor" opacity=".2" />
      <rect x="6" y="8" width="5" height="6" rx="1" fill="currentColor" />
      <rect x="13" y="5" width="5" height="9" rx="1" fill="currentColor" opacity=".85" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  build: (
    <>
      <path
        d="M8 4h3l1 3h5l1-3h3l-2.2 7H10.2L8 4z"
        fill="currentColor"
        opacity=".2"
      />
      <path
        d="M4 11h16l-2 9H6l-2-9z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="currentColor"
        fillOpacity=".15"
      />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="6.5" rx="7" ry="2.5" fill="currentColor" opacity=".25" />
      <path
        d="M5 6.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5 10.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5 14.5v3c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </>
  ),
  deploy: (
    <>
      <path
        d="M12 3l7 12H5L12 3z"
        fill="currentColor"
        opacity=".18"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="9.5" y="14" width="5" height="7" rx="1" fill="currentColor" />
      <path d="M7 21h10" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  verify: (
    <>
      <circle cx="12" cy="12" r="8" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8.2 12.2l2.6 2.6 5.2-5.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  notify: (
    <>
      <path
        d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2H4.5L6 16z"
        fill="currentColor"
        opacity=".2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
};

export function StageIcon({
  box,
  size = 22,
  className,
}: { box: PipelineBoxType } & IconProps) {
  return (
    <Svg size={size} className={className}>
      {STAGE_PATHS[box]}
    </Svg>
  );
}

/** Distinct brand-colored badges for connection types */
export function ConnectionBadge({
  type,
  size = 28,
}: {
  type: ConnectionType;
  size?: number;
}) {
  const common = { width: size, height: size, viewBox: "0 0 32 32", className: "conn-badge" };
  switch (type) {
    case "git":
      return (
        <svg {...common} aria-label="GitHub">
          <rect width="32" height="32" rx="8" fill="#24292F" />
          <circle cx="11" cy="20" r="2.1" fill="#fff" />
          <circle cx="16" cy="12" r="2.1" fill="#fff" />
          <circle cx="22" cy="18" r="2.1" fill="#fff" />
          <path d="M11 18V14.2L16 14.2M16 14.1V20.2" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "jira":
      return (
        <svg {...common} aria-label="Jira">
          <rect width="32" height="32" rx="8" fill="#1868DB" />
          <path d="M16.2 6.5l7.6 7.6-7.6 7.6-3.2-3.2 4.4-4.4-4.4-4.4 3.2-3.2z" fill="#fff" />
          <path d="M12.2 10.6l3.6 3.6-3.6 3.6-3.6-3.6 3.6-3.6z" fill="#fff" opacity=".85" />
        </svg>
      );
    case "model":
      return (
        <svg {...common} aria-label="Model">
          <rect width="32" height="32" rx="8" fill="#5B3CC4" />
          <circle cx="11" cy="13" r="2.2" fill="#F4C15D" />
          <circle cx="21" cy="13" r="2.2" fill="#7EC8C4" />
          <circle cx="16" cy="20" r="2.2" fill="#fff" />
          <path d="M12.6 14.6l2.2 4.1M19.4 14.6l-2.2 4.1M13.2 13h5.6" stroke="#fff" strokeWidth="1.2" />
        </svg>
      );
    case "ssh":
      return (
        <svg {...common} aria-label="SSH">
          <rect width="32" height="32" rx="8" fill="#2B3A4A" />
          <path
            d="M10 14a4 4 0 1 1 6.8 2.8L20 20v2h-2v2h-2v-2h-1.2l-1.5-1.5A4 4 0 0 1 10 14zm4 0a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 14 14z"
            fill="#F4C15D"
          />
        </svg>
      );
    case "aws":
      return (
        <svg {...common} aria-label="AWS">
          <rect width="32" height="32" rx="8" fill="#232F3E" />
          <path d="M9 20.2c2.6 1.8 6.4 2.8 9.4 2.8 2 0 3.8-.3 4.8-.9" stroke="#FF9900" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M22.4 18.6l1.6 1.5-2.4 1.2" fill="#FF9900" />
          <text x="16" y="16" textAnchor="middle" fill="#fff" fontSize="9" fontFamily="Georgia, serif" fontWeight="700">
            aws
          </text>
        </svg>
      );
    case "azure":
      return (
        <svg {...common} aria-label="Azure">
          <rect width="32" height="32" rx="8" fill="#0078D4" />
          <path d="M14 8l-7 16h6.2l7.3-16H14zm2.2 0l3.4 8.2L24 24h-5.5L16.2 8z" fill="#fff" />
        </svg>
      );
    case "gcp":
      return (
        <svg {...common} aria-label="GCP">
          <rect width="32" height="32" rx="8" fill="#F8F9FA" stroke="#DADCE0" />
          <circle cx="12" cy="14" r="4" fill="#EA4335" />
          <circle cx="20" cy="14" r="4" fill="#4285F4" />
          <circle cx="16" cy="20" r="4" fill="#34A853" />
          <circle cx="16" cy="12" r="3" fill="#FBBC05" />
        </svg>
      );
    case "docker":
      return (
        <svg {...common} aria-label="Docker">
          <rect width="32" height="32" rx="8" fill="#2496ED" />
          <path
            d="M6 17h3v3H6v-3zm4 0h3v3h-3v-3zm4 0h3v3h-3v-3zm-8-4h3v3H6v-3zm4 0h3v3h-3v-3zm4 0h3v3h-3v-3zm4 0h3v3h-3v-3zm-4-4h3v3h-3V9z"
            fill="#fff"
          />
          <path d="M5 21c1.5 2 5 3 10 3s9.5-1 11.5-3H5z" fill="#fff" opacity=".85" />
        </svg>
      );
    case "kubernetes":
      return (
        <svg {...common} aria-label="Kubernetes">
          <rect width="32" height="32" rx="8" fill="#326CE5" />
          <path
            d="M16 6l2.2 3.8 4.3.7-3.1 3.1.7 4.3L16 16.2l-4.1 1.7.7-4.3-3.1-3.1 4.3-.7L16 6z"
            fill="#fff"
          />
        </svg>
      );
    case "registry":
      return (
        <svg {...common} aria-label="Registry">
          <rect width="32" height="32" rx="8" fill="#0B5F63" />
          <rect x="8" y="8" width="16" height="4" rx="1" fill="#7EC8C4" />
          <rect x="8" y="14" width="16" height="4" rx="1" fill="#C26A2D" />
          <rect x="8" y="20" width="16" height="4" rx="1" fill="#F4F7F8" />
        </svg>
      );
    case "notify":
      return (
        <svg {...common} aria-label="Notify">
          <rect width="32" height="32" rx="8" fill="#C26A2D" />
          <path
            d="M10 18V13a6 6 0 1 1 12 0v5l2 3H8l2-3z"
            fill="#fff"
          />
          <path d="M14 23a2 2 0 0 0 4 0" stroke="#fff" strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="8" fill="#5C6B76" />
        </svg>
      );
  }
}

export const STAGE_THEME: Record<
  PipelineBoxType,
  { label: string; hint: string; tone: string }
> = {
  source: { label: "Get code", hint: "From Git", tone: "source" },
  infra: { label: "Prepare host", hint: "VM or cloud", tone: "infra" },
  build: { label: "Package", hint: "Image and files", tone: "build" },
  data: { label: "Database", hint: "Optional", tone: "data" },
  deploy: { label: "Go live", hint: "Compose or SSH", tone: "deploy" },
  verify: { label: "Health check", hint: "Is it up?", tone: "verify" },
  notify: { label: "Alerts", hint: "Email or webhook", tone: "notify" },
};

export const CONN_LABELS: Record<ConnectionType, string> = {
  jira: "Jira",
  git: "Git",
  model: "Model",
  ssh: "SSH",
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
  docker: "Docker",
  registry: "Registry",
  kubernetes: "Kubernetes",
  notify: "Notify",
};
