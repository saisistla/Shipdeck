export function health() {
  return { status: "ok", ticket: "SHIP-200", product: "Organic vegetable farming" };
}

export const store = {
  crops: [{ id: "crops-1", name: "Tomato", source: "fixture" }],
  harvests: [{ id: "harvests-1", name: "Morning pick", source: "fixture" }],
  plots: [{ id: "plots-1", name: "North field", source: "fixture" }]
};

export function list(entity) {
  if (!store[entity]) throw new Error("unknown resource");
  return store[entity];
}
