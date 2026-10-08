"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

/**
 * Draws a QR code in the browser from the given text; nothing is sent anywhere. Always dark on white
 * with a quiet zone, whatever the theme, because that is what phone cameras can read.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const size = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { size, path };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`-4 -4 ${size + 8} ${size + 8}`}
      shapeRendering="crispEdges"
      className="size-48 shrink-0 rounded-md border border-border bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
