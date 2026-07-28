export type ChartTimeScope = "context" | "full";

export const shiftMonth = (month: string, offset: number) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const absoluteMonth = year * 12 + monthNumber - 1 + offset;
  const shiftedYear = Math.floor(absoluteMonth / 12);
  const shiftedMonth = (absoluteMonth % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
};

export const filterAroundLatestReal = <T extends { fullDate: string }>(
  rows: T[],
  latestRealMonth: string | undefined,
  scope: ChartTimeScope,
) => {
  if (scope === "full" || !latestRealMonth) return rows;
  const start = shiftMonth(latestRealMonth, -1);
  const end = shiftMonth(latestRealMonth, 1);
  return rows.filter(
    (row) => row.fullDate >= start && row.fullDate <= end,
  );
};
