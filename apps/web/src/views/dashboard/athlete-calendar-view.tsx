import { useGetMyEventsQuery } from '@/api/event';
import { Calendar } from '@/components/calendar/calendar';
import { useCallback, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { getDesktopCalendarWindow } from './calendar-window';

interface P {
  athleteId: number;
}

export function AthleteCalendarView({ athleteId }: P) {
  const [displayedMonth, setDisplayedMonth] = useState(new Date());

  const { startDate, endDate } = useMemo(
    () => getDesktopCalendarWindow(displayedMonth),
    [displayedMonth],
  );

  const { data, isError, isFetching } = useGetMyEventsQuery(
    true,
    athleteId,
    startDate,
    endDate,
    {
      retry: false,
    },
  );

  const handleMonthChange = useCallback((month: Date) => {
    setDisplayedMonth(month);
  }, []);

  if (isError) {
    return <Navigate to="/404" />;
  }
  return (
    <div className="flex h-full w-full flex-col md:p-8">
      <Calendar
        events={data}
        athleteId={athleteId}
        onMonthChange={handleMonthChange}
        isLoading={isFetching}
      />
    </div>
  );
}
