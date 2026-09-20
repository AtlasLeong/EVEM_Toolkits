import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import PosterStudio from './PosterStudio';
import '../../styles/corporationPoster.css';

export default function PosterDialog({ open, onClose, ...studioProps }) {
  const dialog = useRef(null);
  const titleId = useId();
  const containKeyboardFocus = (event) => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.current.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter(item => item.getClientRects().length > 0);
    const first = items[0];
    const last = items.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) {
      document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbar}px`;
    }
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  return createPortal(
    <dialog ref={dialog} className="corp-poster-dialog" aria-labelledby={titleId}
      onKeyDown={containKeyboardFocus}
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className="corp-poster-dialog-header">
        <div>
          <span className="corp-eyebrow">POSTER STUDIO</span>
          <h2 id={titleId}>制作军团海报</h2>
        </div>
        <button type="button" className="corp-poster-close" aria-label="关闭海报制作" onClick={onClose} autoFocus>
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      {open && <PosterStudio {...studioProps} />}
    </dialog>, document.body,
  );
}
