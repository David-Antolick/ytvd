// A saved window position can point at a monitor that has since been unplugged or
// rearranged, leaving the window entirely off-screen with no way to reach it.
// Require enough overlap with some display's work area to grab the title bar.
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 36;

export function boundsVisibleOnAnyDisplay(bounds: Electron.Rectangle, workAreas: Electron.Rectangle[]): boolean {
  return workAreas.some(area => {
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX >= MIN_VISIBLE_WIDTH && overlapY >= MIN_VISIBLE_HEIGHT;
  });
}
