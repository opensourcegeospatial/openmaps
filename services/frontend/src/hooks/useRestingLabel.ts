import type React from 'react';
import { useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * A field holding a picked place reads, at rest, the way people say the place
 * ("Kaffebrenneriet Storgata") instead of Nominatim's long name. Focusing it
 * brings the full text back to edit, selected so that typing replaces it.
 * While the short name shows, the full text is the field's tooltip and its
 * description for assistive technology.
 *
 * `restingLabel` is passed only while `value` is still the picked place's long
 * name; once the user has typed, the field shows what they typed.
 */
export function useRestingLabel(
  value: string,
  restingLabel: string | undefined,
  inputRef: React.RefObject<HTMLInputElement>
) {
  const [focused, setFocused] = useState(false);
  const descriptionId = useId();
  const resting = !focused && Boolean(restingLabel) && restingLabel !== value;

  // Select the full text once it has replaced the short name. A pointer press
  // would collapse that selection on mouseup, so that one mouseup is cancelled.
  const selectRef = useRef(false);
  const keepSelectionRef = useRef(false);
  const pointerFocusRef = useRef(false);
  useLayoutEffect(() => {
    if (focused && selectRef.current) {
      selectRef.current = false;
      inputRef.current?.select();
    }
  }, [focused, inputRef]);

  return {
    resting,
    descriptionId,
    inputProps: {
      value: resting ? (restingLabel as string) : value,
      title: resting ? value : undefined,
      'aria-describedby': resting ? descriptionId : undefined,
      onMouseDown: () => {
        pointerFocusRef.current = document.activeElement !== inputRef.current;
      },
      onMouseUp: (event: React.MouseEvent<HTMLInputElement>) => {
        if (keepSelectionRef.current) {
          keepSelectionRef.current = false;
          event.preventDefault();
        }
      }
    },
    onFocus: () => {
      if (resting) {
        selectRef.current = true;
        keepSelectionRef.current = pointerFocusRef.current;
      }
      pointerFocusRef.current = false;
      setFocused(true);
    },
    onBlur: () => setFocused(false)
  };
}
