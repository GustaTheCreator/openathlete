import client, { routes } from '@/utils/axios';

import {
  CalendarDayForm,
  CalendarWeekLoadSummary,
  TRAINING_LOAD_CALCULATION_TYPE,
  TrainingLoadEntry,
  TrainingLoadMetrics,
} from '@openathlete/shared';

export type TrainingLoadCalculationType = TRAINING_LOAD_CALCULATION_TYPE;
export const TrainingLoadCalculationType = TRAINING_LOAD_CALCULATION_TYPE;

export type { CalendarWeekLoadSummary, TrainingLoadEntry, TrainingLoadMetrics };

const mapTrainingLoadEntry = (entry: TrainingLoadEntry): TrainingLoadEntry => ({
  ...entry,
  date: new Date(entry.date),
  createdAt: new Date(entry.createdAt),
  updatedAt: new Date(entry.updatedAt),
});

const mapCalendarWeekLoadSummary = (
  item: CalendarWeekLoadSummary,
): CalendarWeekLoadSummary => ({
  ...item,
  weekStart: new Date(item.weekStart),
  weekEnd: new Date(item.weekEnd),
});

export class TrainingLoadAPI {
  /**
   * Get all training load entries for a specific activity
   */
  static async getActivityTrainingLoads(
    activityId: number,
  ): Promise<TrainingLoadEntry[]> {
    const res = await client.get(routes.trainingLoad.activity(activityId));
    return res.data.map(mapTrainingLoadEntry);
  }

  /**
   * Get current training load metrics (ATL, CTL, TSB)
   */
  static async getTrainingLoadMetrics(
    calculationType: TrainingLoadCalculationType,
    targetDate?: Date,
    athleteId?: number,
  ): Promise<TrainingLoadMetrics> {
    const res = await client.get(routes.trainingLoad.metrics, {
      params: {
        calculationType,
        ...(targetDate && { targetDate: targetDate.toISOString() }),
        ...(athleteId && { athleteId }),
      },
    });
    return res.data;
  }

  static async getDailyForm(
    startDate: Date,
    endDate: Date,
    athleteId: number | undefined,
    wellness: boolean,
  ): Promise<CalendarDayForm[]> {
    const res = await client.get(routes.trainingLoad.days, {
      params: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        athleteId,
        wellness,
      },
    });
    return res.data;
  }

  static async getWeeklyLoadSummary(
    startDate: Date,
    endDate: Date,
    athleteId?: number,
  ): Promise<CalendarWeekLoadSummary[]> {
    const res = await client.get(routes.trainingLoad.weeklySummary, {
      params: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        ...(athleteId && { athleteId }),
      },
    });
    return res.data.map(mapCalendarWeekLoadSummary);
  }
}
