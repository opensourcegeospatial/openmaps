import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { MapLngLat } from './Map';
import { formatLatLng } from '../lib/format';

/**
 * The map's menu ("Kartvalg"), opened by right-click or Shift+F10 at the map
 * centre. Three groups, divided by hairlines: the question ("Hva er her?"),
 * the route shortcuts, and "Kopier koordinater". Actions only, never options.
 * Only the focused item is in the tab order; Tab or Escape closes the menu and
 * returns focus to where it came from.
 */

// Inline SVG icons in the app's line-icon set. All are aria-hidden: the
// accessible labels live on the menu items.
const iconClass = 'h-4 w-4 shrink-0';

const InfoIcon = () => (
  <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 11v5M12 8h.01" />
  </svg>
);

// A hollow ring: the start, as in the route panel and on the map.
const StartIcon = () => (
  <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
    <circle cx="12" cy="12" r="6" />
  </svg>
);

const WaypointIcon = () => (
  <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" d="M12 3v5M12 16v5" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

const FlagIcon = () => (
  <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 21V4m0 0h10l-1.5 3.5L15 11H5" />
  </svg>
);

const CopyIcon = () => (
  <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </svg>
);

const itemClass =
  'flex w-full items-center gap-2 rounded-md px-4 py-2 text-left transition hover:bg-main-surface-tinted hover:text-main-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default';

interface ContextMenuProps {
  x: number;
  y: number;
  lngLat: MapLngLat;
  /** Look up the address of the point and open its card. */
  onWhatIsHere: (lngLat: MapLngLat) => void;
  onNavigateFrom: (lngLat: MapLngLat) => void;
  onAddWaypoint: (lngLat: MapLngLat) => void;
  onNavigateTo: (lngLat: MapLngLat) => void;
  /** Copy the point's coordinates, as shown in the menu header. */
  onCopyCoordinates: (lngLat: MapLngLat) => void;
  /** Close the menu (Escape / Tab / outside interaction). Restores focus to trigger. */
  onClose: () => void;
}

interface ItemProps {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}

const Item: React.FC<ItemProps> = ({ icon, label, onSelect }) => (
  <li role="none">
    <button type="button" role="menuitem" tabIndex={-1} onClick={onSelect} className={itemClass}>
      {icon} <span>{label}</span>
    </button>
  </li>
);

const Separator = () => <li role="separator" className="mx-4 my-1 border-t border-border-subtle" />;

const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  lngLat,
  onWhatIsHere,
  onNavigateFrom,
  onAddWaypoint,
  onNavigateTo,
  onCopyCoordinates,
  onClose
}: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Remember what was focused before the menu opened so we can restore it.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Collect the menuitem buttons in DOM order for roving focus.
  const getItems = useCallback((): HTMLButtonElement[] => {
    const node = menuRef.current;
    if (!node) return [];
    return Array.from(node.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
  }, []);

  // On open: remember the trigger and move focus to the first menu item.
  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = getItems();
    items[0]?.focus({ preventScroll: true });
    return () => {
      // On close: restore focus to the element that opened the menu.
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && document.contains(toRestore)) {
        toRestore.focus({ preventScroll: true });
      }
    };
  }, [getItems]);

  // Keep the whole menu inside the viewport. Opened near the right or bottom
  // edge it used to overflow, and focusing its first item then scrolled the
  // app shell so the search bar was clipped for as long as the menu was open.
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const margin = 8;
    const left = Math.max(margin, Math.min(x, window.innerWidth - node.offsetWidth - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - node.offsetHeight - margin));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [x, y]);

  const focusItemAt = (index: number) => {
    const items = getItems();
    if (items.length === 0) return;
    const wrapped = (index + items.length) % items.length;
    items[wrapped]?.focus();
  };

  const currentIndex = () => getItems().indexOf(document.activeElement as HTMLButtonElement);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItemAt(currentIndex() + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItemAt(currentIndex() - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItemAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusItemAt(getItems().length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case 'Tab':
        // A menu is one stop: Tab leaves it, back to where it was opened.
        event.preventDefault();
        onClose();
        break;
      // Enter/Space activate the focused <button> natively.
      default:
        break;
    }
  };

  return (
    <div
      ref={menuRef}
      className="absolute z-panel w-64 rounded-lg border border-border-default bg-surface-default shadow-lg"
      style={{ top: y, left: x }}
      role="menu"
      aria-label="Kartvalg"
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
    >
      <div className="border-b border-border-default px-4 py-2 text-xs tabular-nums text-text-subtle">
        {formatLatLng(lngLat.lat, lngLat.lng)}
      </div>
      <ul role="none" className="py-2 text-sm text-text-default">
        <Item icon={<InfoIcon />} label="Hva er her?" onSelect={() => onWhatIsHere(lngLat)} />
        <Separator />
        <Item icon={<StartIcon />} label="Veibeskrivelse herfra" onSelect={() => onNavigateFrom(lngLat)} />
        <Item icon={<WaypointIcon />} label="Viapunkt her" onSelect={() => onAddWaypoint(lngLat)} />
        <Item icon={<FlagIcon />} label="Veibeskrivelse hit" onSelect={() => onNavigateTo(lngLat)} />
        <Separator />
        <Item icon={<CopyIcon />} label="Kopier koordinater" onSelect={() => onCopyCoordinates(lngLat)} />
      </ul>
    </div>
  );
};

export default ContextMenu;
