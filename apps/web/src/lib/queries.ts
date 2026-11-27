import { queryOptions } from '@tanstack/react-query';
import { api } from './api';
import type {
  Role,
  Overview,
  IntelligenceListItem,
  IntelligenceListFilters,
  IntegrationStatus,
  ResearchRun,
  ResearchSchedule,
} from '@guangmo/contracts';
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export const memberQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api<Member>('/me'),
  retry: false,
  staleTime: 60000,
});
export const overviewQuery = queryOptions({
  queryKey: ['overview'],
  queryFn: () => api<Overview>('/overview'),
});
export const integrationQuery = queryOptions({
  queryKey: ['integrations'],
  queryFn: () => api<IntegrationStatus>('/integrations'),
  refetchInterval: 30000,
});
export const intelligenceQuery = (
  filters: Partial<IntelligenceListFilters> = {},
) =>
  queryOptions({
    queryKey: ['intelligence', filters],
    refetchInterval: 10000,
    queryFn: () =>
      api<IntelligenceListItem[]>(
        `/intelligence?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '') as [string, string][])}`,
      ),
  });
export const researchQuery = queryOptions({
  queryKey: ['research'],
  queryFn: () => api<ResearchRun[]>('/research'),
  refetchInterval: 5000,
});
export const scheduleQuery = queryOptions({
  queryKey: ['schedules'],
  queryFn: () => api<ResearchSchedule[]>('/schedules'),
});
