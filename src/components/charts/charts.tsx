"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK_COLOR, CHART_COLORS, GRID_COLOR, chartColor } from "@/lib/chart-colors";

const axisTick = { fontSize: 11, fill: AXIS_TICK_COLOR };
const formatK = (v: number) => `$${(v / 1000).toFixed(0)}k`;
const formatMoney = (v: unknown) => `$${Number(v).toLocaleString()}`;

export function RevenueAreaChart({ data }: { data: Array<{ mes: string; ventas: number; compras: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradVentas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.18} />
            <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradCompras" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS[2]} stopOpacity={0.15} />
            <stop offset="95%" stopColor={CHART_COLORS[2]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey="mes" tick={axisTick} />
        <YAxis tick={axisTick} tickFormatter={formatK} />
        <Tooltip formatter={(v) => [formatMoney(v), ""]} />
        <Area
          type="monotone"
          dataKey="ventas"
          name="Ventas"
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          fill="url(#gradVentas)"
        />
        <Area
          type="monotone"
          dataKey="compras"
          name="Compras"
          stroke={CHART_COLORS[2]}
          strokeWidth={2}
          fill="url(#gradCompras)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MonthlyBarChart({
  data,
  dataKey,
  name,
  color,
}: {
  data: Array<{ mes: string; [key: string]: number | string }>;
  dataKey: string;
  name: string;
  color: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey="mes" tick={axisTick} />
        <YAxis tick={axisTick} tickFormatter={formatK} />
        <Tooltip formatter={(v) => [formatMoney(v), name]} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryPieChart({
  data,
  withLabels = false,
}: {
  data: Array<{ name: string; value: number }>;
  withLabels?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={withLabels ? 250 : 220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          dataKey="value"
          paddingAngle={2}
          innerRadius={withLabels ? 0 : 55}
          outerRadius={withLabels ? 90 : 85}
          label={
            withLabels
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
              : undefined
          }
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={chartColor(i)} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
