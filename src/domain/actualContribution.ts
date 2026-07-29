export interface ActualContributionBreakdown {
  regular: number;
  bonus: number;
}

export const actualContributionTotal = (
  regularContribution: number,
  bonusContribution: number,
) => regularContribution + bonusContribution;

export const changeActualContributionTotal = (
  totalContribution: number,
  currentBonusContribution: number,
): ActualContributionBreakdown => {
  const total = Math.max(0, totalContribution);
  const bonus = Math.min(Math.max(0, currentBonusContribution), total);

  return {
    regular: total - bonus,
    bonus,
  };
};

export const changeActualBonusContribution = (
  currentRegularContribution: number,
  currentBonusContribution: number,
  nextBonusContribution: number,
): ActualContributionBreakdown => {
  const currentTotal = actualContributionTotal(
    currentRegularContribution,
    currentBonusContribution,
  );
  const bonus = Math.max(0, nextBonusContribution);

  return {
    regular: Math.max(0, currentTotal - bonus),
    bonus,
  };
};

export const foldActualBonusIntoRegular = (
  regularContribution: number,
  bonusContribution: number,
): ActualContributionBreakdown => ({
  regular: actualContributionTotal(regularContribution, bonusContribution),
  bonus: 0,
});
