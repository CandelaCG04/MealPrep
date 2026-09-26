import { Bar, RowsCard, Skeleton, TitleBar } from "@/components/skeleton";

export default function Loading() {
  return (
    <Skeleton>
      <TitleBar />
      <Bar className="h-10 rounded-xl" />
      <RowsCard rows={8} />
    </Skeleton>
  );
}
