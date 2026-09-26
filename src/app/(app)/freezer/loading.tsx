import { Bar, RowsCard, Skeleton, TitleBar } from "@/components/skeleton";

export default function Loading() {
  return (
    <Skeleton>
      <TitleBar />
      <Bar className="h-24 rounded-2xl" />
      <RowsCard rows={4} />
    </Skeleton>
  );
}
