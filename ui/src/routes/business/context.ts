import { useOutletContext } from 'react-router';
import type { BuildDetail, LeadDetail } from '../../../../src/ui/api-types';

/** What every business tab receives from the business page. `build` is undefined until a build exists. */
export interface BusinessCtx { slug: string; lead: LeadDetail; build: BuildDetail | undefined; buildLoading: boolean }
export const useBusiness = () => useOutletContext<BusinessCtx>();
