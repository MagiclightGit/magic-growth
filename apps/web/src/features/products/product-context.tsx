import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import type { Product } from '@guangmo/contracts';
import { api } from '@/lib/api';
import { ChoiceSelect } from '@/components/choice-select';
import { Loading, ErrorState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router';
const ProductContext = createContext<{
  products: Product[];
  product: string;
  active: Product[];
  refresh: () => void;
}>({ products: [], product: '', active: [], refresh: () => {} });
export const useProducts = () => useContext(ProductContext);
export const productsQuery = {
  queryKey: ['products'],
  queryFn: () => api<Product[]>('/products'),
  refetchInterval: 10000,
};
export function ProductWorkspace({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const query = useQuery(productsQuery);
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get('product') ?? '';
  const product = query.data?.some((p) => p.id === requested) ? requested : '';
  const signature = (query.data ?? [])
    .map((p) => `${p.id}:${p.archived}`)
    .sort()
    .join(',');
  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: true,
            meta: { userId, product, authorization: signature },
          },
        },
      }),
    [userId, product, signature],
  );
  useEffect(() => () => client.clear(), [client]);
  const preferenceKey = `guangmo-product-${userId}`;
  useEffect(() => {
    if (!query.data) return;
    const params = new URLSearchParams(location.search);
    if (requested && !query.data.some((p) => p.id === requested)) {
      params.delete('product');
      params.delete('item');
      params.delete('run');
      params.delete('task');
      params.delete('watch');
      params.delete('competitor');
      params.delete('batch');
      params.delete('creator');
      params.delete('drama');
      params.delete('fromRun');
      sessionStorage.removeItem(preferenceKey);
      void navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true },
      );
    } else if (requested) {
      sessionStorage.setItem(preferenceKey, requested);
    } else if (!requested) {
      const preferred = sessionStorage.getItem(preferenceKey);
      if (preferred && query.data.some((p) => p.id === preferred)) {
        params.set('product', preferred);
        void navigate(
          { pathname: location.pathname, search: params.toString() },
          { replace: true },
        );
      }
    }
  }, [
    query.data,
    requested,
    location.pathname,
    location.search,
    navigate,
    preferenceKey,
  ]);
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <ProductContext.Provider
      value={{
        products: query.data,
        active: query.data.filter((p) => !p.archived),
        product,
        refresh: () => void query.refetch(),
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            当前产品
          </span>
          <div className="w-48 max-w-full">
            <ChoiceSelect
              label="工作空间产品"
              value={product || 'all'}
              options={[
                { value: 'all', label: '全部授权产品' },
                ...query.data.map((p) => ({
                  value: p.id,
                  label: p.name + (p.archived ? '（已归档）' : ''),
                })),
              ]}
              onValueChange={(value) => {
                const next = value === 'all' ? '' : value;
                if (next) sessionStorage.setItem(preferenceKey, next);
                else sessionStorage.removeItem(preferenceKey);
                const params = new URLSearchParams(location.search);
                for (const key of [
                  'item',
                  'run',
                  'task',
                  'owner',
                  'watch',
                  'competitor',
                  'batch',
                  'creator',
                  'drama',
                ])
                  params.delete(key);
                if (next) params.set('product', next);
                else params.delete('product');
                void navigate({
                  pathname: location.pathname,
                  search: params.toString(),
                });
              }}
            />
          </div>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/products">产品目录</Link>
        </Button>
      </div>
      {!query.data.length && (
        <p className="mb-4 rounded-lg border border-status-warning-fg/20 bg-status-warning-bg/60 px-3.5 py-2.5 text-xs text-status-warning-fg">
          尚未获授权产品，请联系管理员分配产品权限。
        </p>
      )}
      {requested && !product ? (
        <Loading />
      ) : (
        <QueryClientProvider
          key={`${userId}:${product}:${signature}`}
          client={client}
        >
          {children}
        </QueryClientProvider>
      )}
    </ProductContext.Provider>
  );
}
export function ProductField({
  name = 'product',
  defaultValue,
  onChange,
}: {
  name?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const { active, product } = useProducts();
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={`field-${name}`}>
        所属产品
      </label>
      <select
        onChange={(e) => onChange?.(e.target.value)}
        id={`field-${name}`}
        name={name}
        defaultValue={defaultValue ?? product ?? ''}
        required
        className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px]"
      >
        <option value="">请选择产品</option>
        {active.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ProductName({ id }: { id: string | null }) {
  const { products } = useProducts();
  return (
    <>{id ? (products.find((p) => p.id === id)?.name ?? id) : '待关联产品'}</>
  );
}
