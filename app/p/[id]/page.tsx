import { PersonView } from "./person-view";

export default async function PersonPage({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  return <PersonView id={id} />;
}
