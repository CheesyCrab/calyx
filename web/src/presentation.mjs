export function presentationRate(value) {
  const rate = value ?? 60;
  if (rate !== 30 && rate !== 60) {
    throw new Error(`presentation must be 30 or 60, got ${JSON.stringify(value)}`);
  }
  return rate;
}

export function shouldPresent(completedTicks, rate) {
  if (completedTicks <= 0) return false;
  return rate === 60 || (completedTicks - 1) % 2 === 0;
}
