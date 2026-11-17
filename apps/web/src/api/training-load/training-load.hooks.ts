import { QueryOptions, useQuery } from '@tanstack/react-query';

import {
  TrainingLoadAPI,
  TrainingLoadCalculationType,
} from './training-load.api';
import { trainingLoadKeys } from './training-load.keys';

export const useTrainingLoadMetrics = (
  calculationType: TrainingLoadCalculationType,
  targetDate?: Date,
  athleteId?: number,
  opt?: QueryOptions<
    Awaited<ReturnType<typeof TrainingLoadAPI.getTrainingLoadMetrics>>
  >,
) =>
  useQuery({
    ...opt,
    queryFn: () =>
      TrainingLoadAPI.getTrainingLoadMetrics(
        calculationType,
        targetDate,
        athleteId,
      ),
    queryKey: [
      trainingLoadKeys.getTrainingLoadMetrics,
      calculationType,
      targetDate?.toISOString(),
      athleteId,
    ],
  });

export const useWeeklyLoadSummaryQuery = (
  startDate?: Date,
  endDate?: Date,
  athleteId?: number,
  enabled?: boolean,
  opt?: QueryOptions<
    Awaited<ReturnType<typeof TrainingLoadAPI.getWeeklyLoadSummary>>
  >,
) =>
  useQuery({
    ...opt,
    enabled:
      (enabled ?? true) && Boolean(startDate && endDate) && Boolean(athleteId),
    queryFn: () => {
      if (!startDate || !endDate) {
        return Promise.resolve([]);
      }
      return TrainingLoadAPI.getWeeklyLoadSummary(
        startDate,
        endDate,
        athleteId,
      );
    },
    queryKey: [
      trainingLoadKeys.getWeeklyLoadSummary,
      startDate?.toISOString(),
      endDate?.toISOString(),
      athleteId,
    ],
  });

export const useActivityTrainingLoads = (
  activityId: number,
  opt?: QueryOptions<
    Awaited<ReturnType<typeof TrainingLoadAPI.getActivityTrainingLoads>>
  >,
) =>
  useQuery({
    ...opt,
    queryFn: () => TrainingLoadAPI.getActivityTrainingLoads(activityId),
    queryKey: [trainingLoadKeys.getActivityTrainingLoads, activityId],
  });

/**
 * Day by day load and form of a calendar range, with the wellness
 * measurements only when the athlete records some (`wellness`).
 */
export const useDailyFormQuery = ({
  startDate,
  endDate,
  athleteId,
  wellness,
  enabled = true,
}: {
  startDate?: Date;
  endDate?: Date;
  athleteId?: number;
  wellness: boolean;
  enabled?: boolean;
}) =>
  useQuery({
    enabled: enabled && Boolean(startDate && endDate && athleteId),
    queryFn: () =>
      TrainingLoadAPI.getDailyForm(startDate!, endDate!, athleteId, wellness),
    queryKey: [
      trainingLoadKeys.getDailyForm,
      startDate?.toISOString(),
      endDate?.toISOString(),
      athleteId,
      wellness,
    ],
  });
