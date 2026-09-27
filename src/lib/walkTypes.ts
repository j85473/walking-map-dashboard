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
  green: number;
  yellow: number;
  orange: number;
  red: number;
  purple: number;
};
