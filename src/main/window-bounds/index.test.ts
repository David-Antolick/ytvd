import { describe, expect, it } from "vitest";

import { boundsVisibleOnAnyDisplay } from "./index";

const primary = { x: 0, y: 0, width: 1920, height: 1032 };
const leftPair = [
  { x: -2560, y: -60, width: 2560, height: 1392 },
  { x: -5120, y: -60, width: 2560, height: 1392 }
];

describe("boundsVisibleOnAnyDisplay", () => {
  it("accepts a window fully inside a display", () => {
    expect(boundsVisibleOnAnyDisplay({ x: 100, y: 84, width: 900, height: 1000 }, [primary])).toBe(true);
  });

  it("accepts a window on a secondary display with negative coordinates", () => {
    expect(boundsVisibleOnAnyDisplay({ x: -2000, y: 100, width: 800, height: 600 }, [primary, ...leftPair])).toBe(true);
  });

  it("rejects a window saved on a monitor that is no longer attached", () => {
    expect(boundsVisibleOnAnyDisplay({ x: 3179, y: 84, width: 661, height: 1032 }, [primary, ...leftPair])).toBe(false);
  });

  it("rejects a window that only overlaps by a sliver", () => {
    expect(boundsVisibleOnAnyDisplay({ x: 1880, y: 84, width: 661, height: 1032 }, [primary])).toBe(false);
  });

  it("accepts a window hanging partly off the edge but still grabbable", () => {
    expect(boundsVisibleOnAnyDisplay({ x: 1700, y: -10, width: 661, height: 1032 }, [primary])).toBe(true);
  });
});
