import { z } from 'zod';
export const productId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    '产品标识仅支持字母、数字、下划线和连字符',
  )
  .refine((value) => value !== 'all', '该产品标识为保留值');
export const productInput = z.object({
  id: productId,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).default(''),
});
export const productUpdate = productInput
  .omit({ id: true })
  .partial()
  .extend({ archived: z.boolean().optional() });
export const productGrants = z.object({
  productIds: z.array(productId).max(100),
  revision: z.number().int().min(0),
});
export interface Product {
  id: string;
  name: string;
  description: string;
  archived: boolean;
}
