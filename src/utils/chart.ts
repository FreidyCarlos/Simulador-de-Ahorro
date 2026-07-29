export type ChartView = "actual" | "ideal";

export const filterChartForView = <T extends { fullDate: string }>(
  rows: T[],
  windowEndMonth: string | undefined,
  view: ChartView,
  windowSize = 4,
) => {
  if (view === "ideal" || !windowEndMonth) return rows;
  const endIndex = rows.findIndex((row) => row.fullDate === windowEndMonth);
  if (endIndex < 0) return rows.slice(0, windowSize);
  return rows.slice(Math.max(0, endIndex - windowSize + 1), endIndex + 1);
};

export const getChartMonthNeighbors = <T extends { fullDate: string }>(
  rows: T[],
  selectedMonth: string | undefined,
) => {
  const selectedIndex = rows.findIndex(
    (row) => row.fullDate === selectedMonth,
  );

  return {
    previous: selectedIndex > 0 ? rows[selectedIndex - 1] : undefined,
    next:
      selectedIndex >= 0 && selectedIndex < rows.length - 1
        ? rows[selectedIndex + 1]
        : undefined,
  };
};

export const moveActualChartWindow = <T extends { fullDate: string }>(
  rows: T[],
  currentEndMonth: string | undefined,
  selectedMonth: string,
  windowSize = 4,
) => {
  const selectedIndex = rows.findIndex((row) => row.fullDate === selectedMonth);
  if (selectedIndex < 0) return currentEndMonth ?? selectedMonth;

  const currentEndIndex = rows.findIndex(
    (row) => row.fullDate === currentEndMonth,
  );
  if (currentEndIndex < 0 || selectedIndex > currentEndIndex) {
    return selectedMonth;
  }

  const currentStartIndex = Math.max(0, currentEndIndex - windowSize + 1);
  if (selectedIndex < currentStartIndex) {
    return rows[
      Math.min(rows.length - 1, selectedIndex + windowSize - 1)
    ]?.fullDate ?? currentEndMonth ?? selectedMonth;
  }

  return currentEndMonth ?? selectedMonth;
};
