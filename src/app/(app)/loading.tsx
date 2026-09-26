import { RowsCard, Skeleton, StatsRow, TitleBar } from "@/components/skeleton";

export default function Loading() {
  return (
    <Skeleton>
      <TitleBar />
      <StatsRow />
      <RowsCard rows={3} />
      <RowsCard rows={3} />
    </Skeleton>
  );
}
