export const CHART_COLORS = [
  "#f97316",
  "#1c1917",
  "#6b6560",
  "#10b981",
  "#ef4444",
  "#d6d3ce",
] as const;

export const AXIS_TICK_COLOR = "#6b6560";
export const GRID_COLOR = "#e5e2de";

export const chartColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
