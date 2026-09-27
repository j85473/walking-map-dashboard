export type Walk = {
  id: string;
  name: string;
  date: string;
  points: [number, number][];
  distanceMiles: number;
  steps: number;
};

export type WalkSummary = {
  count: number;
  distanceMiles: number;
  steps: number;
  latestDate: string | null;
};

export type ColorOpacities = {
  blue: number;
  cyan: number;
  amber: number;
  red: number;
  purple: number;
};
