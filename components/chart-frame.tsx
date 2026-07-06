"use client";

import { useEffect, useState } from "react";
import { ResponsiveContainer } from "recharts";

/**
 * Owija Recharts ResponsiveContainer i renderuje go DOPIERO po zamontowaniu
 * na kliencie. Bez tego ResponsiveContainer bywa mierzony przy szerokości 0
 * (SSR/hydracja w Next 16 + React 19) i wykres nie renderuje SVG.
 */
export function ChartFrame({
  height,
  children,
}: {
  height: number;
  children: React.ReactElement;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div style={{ width: "100%", height }}>
      {mounted && (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
