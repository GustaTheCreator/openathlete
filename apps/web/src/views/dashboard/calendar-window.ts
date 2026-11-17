export function getDesktopCalendarWindow(displayedMonth: Date) {
  const startDate = new Date(
    displayedMonth.getFullYear(),
    displayedMonth.getMonth() - 1,
    1,
  );
  const endDate = new Date(
    displayedMonth.getFullYear(),
    displayedMonth.getMonth() + 2,
    0,
  );
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}
