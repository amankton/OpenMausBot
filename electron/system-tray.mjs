// Retain the Windows notification-area identity across app restarts.
export function createSystemTray({ Tray, Menu, nativeImage, iconPath, getWindow, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }),
    "eb6b638b-e927-41c6-b944-7a220c6c8582");
  let hidden = false;
  const show = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    hidden = false;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  };
  tray.setToolTip("Chief Executive Suite");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Chief Executive Suite", click: show },
    { type: "separator" },
    { label: "Quit Chief Executive Suite", click: onQuit },
  ]));
  tray.on("click", show);
  tray.on("double-click", show);
  return {
    show,
    hide(win) { hidden = true; win.setSkipTaskbar(true); win.hide(); },
    isHidden() { return hidden; },
    windowShown(win) { hidden = false; win.setSkipTaskbar(false); },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}
