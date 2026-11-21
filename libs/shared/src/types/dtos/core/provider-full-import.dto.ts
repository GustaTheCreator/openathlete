import { z } from 'zod';

export const providerHistoryPeriodSchema = z.enum([
  '1w',
  '1m',
  '2m',
  '6m',
  '1y',
]);

export type ProviderHistoryPeriod = z.infer<typeof providerHistoryPeriodSchema>;

export const providerFullImportRequestSchema = z
  .union([
    z.strictObject({ period: providerHistoryPeriodSchema.optional() }),
    z.strictObject({ period: z.literal('all') }),
    z.strictObject({
      period: z.literal('custom'),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
    }),
  ])
  .refine(
    (request) =>
      request.period !== 'custom' || request.startDate <= request.endDate,
    {
      path: ['endDate'],
      message: 'End date must be on or after the start date',
    },
  )
  .default({});

export type ProviderFullImportRequestDto = z.infer<
  typeof providerFullImportRequestSchema
>;
