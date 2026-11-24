import { connection } from "next/server";
import { App } from "@/ui/app";
import { mode } from "@/server/config";

export default async function Page() {
  await connection();
  return <App preview={mode() === "demo"} />;
}
