import React from 'react';
import { ToastContext, type ToastApi } from './toast-context';

/**
 * Access the toast API. Must be called within a `<ToastProvider>`.
 *
 * Example:
 *   const toast = useToast();
 *   toast.error('Kunne ikke beregne ruten.');
 */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}
