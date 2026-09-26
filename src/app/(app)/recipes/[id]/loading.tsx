import { Bar, RowsCard, Skeleton, TitleBar } from "@/components/skeleton";

export default function Loading() {
  return (
    <Skeleton>
      <TitleBar />
      <Bar className="h-16 rounded-2xl" />
      <RowsCard rows={6} />
      <RowsCard rows={3} />
    </Skeleton>
  );
}
