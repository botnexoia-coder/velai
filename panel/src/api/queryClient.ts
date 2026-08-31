// QueryClient del panel. Envuelve TanStack Query con los defaults que le van a un panel
// interno detrás de Access:
//  - las mutaciones y las cargas de vista encienden la barra de actividad vía api();
//  - los REFETCHES (polling de la bandeja, invalidaciones) son sondeos de fondo y van
//    en silencio — para eso está quietRefetch().
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Un 403/404 no se arregla reintentando; el resto, un solo reintento.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
        staleTime: 15_000,
      },
    },
  });
}

/**
 * Decide si esta ejecución del queryFn es un refetch (ya hay datos para esa clave) y por
 * tanto debe ir en silencio: la primera carga de una vista SÍ enciende la barra; el
 * polling y las recargas tras una acción, no — exactamente el reparto del panel v1
 * (api(..., quiet) en los sondeos, loadInbox(true) tras cada acción).
 */
export function quietRefetch(client: QueryClient, queryKey: readonly unknown[]): boolean {
  const state = client.getQueryState(queryKey);
  return Boolean(state && state.dataUpdatedAt > 0);
}
