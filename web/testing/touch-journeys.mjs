const PLAY_INPUTS = new Set(["up", "down", "left", "right", "a", "b", "start"]);

export function validateTouchJourneys(catalog, journeys) {
  if (!Array.isArray(journeys) || journeys.length === 0) {
    throw new Error("representative touch journey registry must be a non-empty array");
  }
  const carts = Array.isArray(catalog?.carts) ? catalog.carts : [];
  const seen = new Set();
  for (const journey of journeys) {
    if (!journey || typeof journey.name !== "string" ||
        typeof journey.category !== "string" || !PLAY_INPUTS.has(journey.play)) {
      throw new Error(`invalid representative touch journey: ${JSON.stringify(journey)}`);
    }
    if (seen.has(journey.name)) {
      throw new Error(`${journey.name}: duplicate representative touch journey`);
    }
    seen.add(journey.name);
    const target = carts.find((cart) => cart.name === journey.name);
    if (!target) {
      throw new Error(`${journey.name}: representative touch journey target is missing from catalog`);
    }
    const category = target.category || "Games";
    if (category !== journey.category) {
      throw new Error(
        `${journey.name}: representative touch journey expected category ${journey.category}, got ${category}`,
      );
    }
  }
  return journeys;
}

export function selectTouchJourneys(catalog, journeys, profile) {
  if (!new Set(["release", "sideb"]).has(profile)) {
    throw new Error("touch journey profile must be release or sideb");
  }
  const expected = profile === "release"
    ? journeys.filter((journey) => journey?.name !== "Settings")
    : journeys;
  return validateTouchJourneys(catalog, expected);
}
