/** Distinct overlay palette — ink/amber workshop, not purple AI defaults. */
const PALETTE = [
  "#E8A54B",
  "#3DB8A0",
  "#D45D5D",
  "#6B8FD4",
  "#C4A35A",
  "#8F6BC9",
  "#5BA85B",
  "#D4783A",
  "#4AA8C9",
  "#C96B8F",
  "#7A9E4E",
  "#B87A4A",
  "#5C7A9E",
  "#A85C7A",
  "#6A9E8A",
];

export function partColor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

export function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b, Math.round(alpha * 255)];
}
