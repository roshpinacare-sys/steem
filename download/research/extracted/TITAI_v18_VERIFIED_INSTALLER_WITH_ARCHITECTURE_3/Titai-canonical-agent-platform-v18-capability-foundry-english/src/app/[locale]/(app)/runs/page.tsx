import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth/session";
import { listRuns } from "@/lib/db/queries/runs";
import { PageHeader } from "@/components/shell/page-header";
import { RunsList } from "@/components/runs/runs-list";

export default async function RunsPage() {
  const user = await requireUser();
  const t = await getTranslations();
  const runs = listRuns(user.id);
  return (
    <>
      <PageHeader title={t("runs.title")} subtitle={t("runs.subtitle")} />
      <RunsList initial={runs} />
    </>
  );
}
