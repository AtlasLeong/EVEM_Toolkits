let activeGuard;
let installed = false;

// Register before BrowserRouter subscribes. For window-targeted popstate events,
// a listener added by the lazily mounted editor can be too late to stop the
// router's transition, even when that listener requests the capture phase.
export function installCorporationNavigationGuard() {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", (event) => activeGuard?.(event), true);
}

export function registerCorporationPopGuard(guard) {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = undefined;
  };
}
