import DashboardClient from "./components/DashboardClient";
import { getWalkSummary } from "@/lib/dashboardData";

export const dynamic = "force-dynamic";

export default async function Home() {
  const summary = await getWalkSummary().catch(error => {
    console.error("Unable to load walking summary", error);
    return null;
  });
  return <DashboardClient initialSummary={summary} />;
}
