import { OSM_CREDIT } from './attribution';

export type MapStyle = {
  id: string;
  name: string;
  url: string;
  attribution?: string;
};

/**
 * Built-in basemap list, used when the runtime config sets no MAP_STYLES.
 *
 * Only the local tile server is offered: it works without internet access, and
 * no request goes to a third-party tile provider unless the operator opts in.
 * Extra basemaps are opt-in via MAP_STYLES.
 */
export const defaultMapStyles: MapStyle[] = [
  {
    id: 'local',
    name: 'Lokale kartfliser',
    url: '/tiles/{z}/{x}/{y}.png',
    attribution: OSM_CREDIT
  }
];
