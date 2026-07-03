export function WiseFlowLogo({ size = 24, showText = false }: { size?: number; showText?: boolean }) {
  return (
    <svg width={showText ? size * 3.5 : size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Interlocking W + F symbol: two flowing strokes */}
      <path
        d="M2 18 L5 6 L8 14 L11 6 L14 14 L17 6 L20 18"
        stroke="#3b5bdb"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 18 Q22 14 20 10 Q18 8 19 6"
        stroke="#3b5bdb"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
