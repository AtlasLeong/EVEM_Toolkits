import { useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { registerCorporationPopGuard } from "../../utils/corporationNavigationGuard";

const message = "有未保存的军团修改，离开将丢失这些内容。确定离开吗？";

// BrowserRouter has no data-router blocker. Guard its shared navigator without
// replacing the router, and use the browser's own prompt for reload/close.
export default function useUnsavedCorporation(dirty) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    let index = window.history.state?.idx;
    const originals = { push: navigator.push, replace: navigator.replace };
    const wrappers = {};
    for (const method of Object.keys(originals)) {
      wrappers[method] = (...args) => {
        if (!dirtyRef.current || window.confirm(message)) {
          const result = originals[method].apply(navigator, args);
          index = window.history.state?.idx;
          return result;
        }
      };
      navigator[method] = wrappers[method];
    }
    const beforeUnload = (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    let restoring = false;
    const pop = (event) => {
      const next = event.state?.idx;
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      if (dirtyRef.current && !window.confirm(message)) {
        // React Router supplies indexes for same-document entries. Stop its
        // listener while returning to the unchanged editor's history entry.
        if (
          Number.isInteger(index) &&
          Number.isInteger(next) &&
          index !== next
        ) {
          event.stopImmediatePropagation();
          restoring = true;
          window.history.go(index - next);
          return;
        }
      }
      index = next;
    };
    window.addEventListener("beforeunload", beforeUnload);
    const unregisterPop = registerCorporationPopGuard(pop);
    return () => {
      for (const method of Object.keys(originals))
        if (navigator[method] === wrappers[method])
          navigator[method] = originals[method];
      window.removeEventListener("beforeunload", beforeUnload);
      unregisterPop();
    };
  }, [navigator]);
}
