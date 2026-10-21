import { useEffect, useRef } from 'react';

export const CONFIRM_UNSAVED_SIGN_OUT = 'confirm-unsaved-navigation';

export function useUnsavedSignOut(dirty: boolean, message: string) {
  const current = useRef({ dirty, message });
  current.current = { dirty, message };
  useEffect(() => {
    const confirmSignOut = (event: Event) => {
      if (!event.defaultPrevented && current.current.dirty && !window.confirm(current.current.message)) event.preventDefault();
    };
    document.addEventListener(CONFIRM_UNSAVED_SIGN_OUT, confirmSignOut);
    return () => document.removeEventListener(CONFIRM_UNSAVED_SIGN_OUT, confirmSignOut);
  }, []);
}
