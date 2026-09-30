import { DateView } from "./date-view";

export default async function DatePage({ params }: PageProps<"/date/[id]">) {
  const { id } = await params;
  return <DateView id={id} />;
}
